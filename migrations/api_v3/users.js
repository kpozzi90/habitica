/* eslint-disable no-console */

// Migrate users collection to new schema
// This should run AFTER challenges migration

// This code makes heavy use of ES6 / 7 features and should be compiled / run with BabelJS.

// It requires two environment variables: MONGODB_OLD and MONGODB_NEW

/*
  tags must have a name
*/

console.log('Starting migrations/api_v3/users.js.');

import Q from 'q';
import MongoDB from 'mongodb';
import nconf from 'nconf';
import mongoose from 'mongoose';
import _ from 'lodash';

// Initialize configuration
import setupNconf from '../../website/src/libs/api-v3/setupNconf';
setupNconf();

const MONGODB_OLD = nconf.get('MONGODB_OLD');
const MONGODB_NEW = nconf.get('MONGODB_NEW');

mongoose.Promise = Q.Promise; // otherwise mongoose models won't work

// Load old and new models
import { model as NewUser } from '../../website/src/models/user';
import * as Tasks from '../../website/src/models/task';

// To be defined later when MongoClient connects
let mongoDbOldInstance;
let oldUserCollection;

let mongoDbNewInstance;
let newUserCollection;
let newTaskCollection;

async function processUser (_id) {
  let [oldUser] = await oldUserCollection
    .find({_id})
    .limit(1)
    .toArray();

  let oldTasks = oldUser.habits.concat(oldUser.dailys).concat(oldUser.rewards).concat(oldUser.todos);
  oldUser.habits = oldUser.dailys = oldUser.rewards = oldUser.todos = undefined;

  oldUser.challenges = [];
  oldUser.invitations.guilds = [];
  oldUser.invitations.party = {};
  oldUser.party = {};
  oldUser.tags = oldUser.tags.map(tag => {
    return {
      _id: tag.id,
      name: tag.name,
      challenge: tag.challenge,
    };
  });

  let newUser = new NewUser(oldUser);

  let batchInsertTasks = newTaskCollection.initializeUnorderedBulkOp();
  oldTasks.forEach(oldTask => {
    let newTask = new Tasks[oldTask.type](oldTask);
    newTask.userId = newUser._id;

    newTask.challenge = {};
    if (!oldTask.text) newTask.text = 'text';
    newTask.tags = _.map(oldTask.tags, (tagPresent, tagId) => {
      return tagPresent && tagId;
    });

    newUser.tasksOrder[`${oldTask.type}s`].push(newTask._id);

    let newTaskObject = newTask.toObject();
    newTaskObject.legacyId = oldTask.id;

    batchInsertTasks.insert(newTaskObject);
  });

  await Q.all([
    newUserCollection.insertOne(newUser.toObject()),
    batchInsertTasks.execute(),
  ]);

  console.log(`Saved user ${newUser._id} and their tasks.`);
}

/*

TODO var challengeTasksChangedId = {};
... given a user

let processed = 0;
let batchSize = 1000;

var db; // defined later by MongoClient
var dbNewUsers;
var dbTasks;

var processUser = function(gt) {
  var query = {
    _id: {}
  };
  if(gt) query._id.$gt = gt;

  console.log('Launching query', query);

  // take batchsize docs from users and process them
  OldUserModel
    .find(query)
    .lean() // Use plain JS objects as old user data won't match the new model
    .limit(batchSize)
    .sort({_id: 1})
    .exec(function(err, users) {
      if(err) throw err;

      console.log('Processing ' + users.length + ' users.', 'Already processed: ' + processed);

      var lastUser = null;
      if(users.length === batchSize){
        lastUser = users[users.length - 1];
      }

      var tasksToSave = 0;

      // Initialize batch operation for later
      var batchInsertUsers = dbNewUsers.initializeUnorderedBulkOp();
      var batchInsertTasks = dbTasks.initializeUnorderedBulkOp();

      users.forEach(function(user){
        // user obj is a plain js object because we used .lean()

        // add tasks order arrays
        user.tasksOrder = {
          habits: [],
          rewards: [],
          todos: [],
          dailys: []
        };

        // ... convert tasks to individual models

        var tasksArr = user.dailys
                          .concat(user.habits)
                          .concat(user.todos)
                          .concat(user.rewards);

        // free memory?
        user.dailys = user.habits = user.todos = user.rewards = undefined;

        tasksArr.forEach(function(task){
          task.userId = user._id;

          task._id = shared.uuid(); // we rely on these to be unique... hopefully!
          task.legacyId = task.id;
          task.id = undefined;

          task.challenge = task.challenge || {};
          if(task.challenge.id) {
            // If challengeTasksChangedId[task._id] then we got on of the duplicates from the challenges migration
            if (challengeTasksChangedId[task.legacyId]) {
              var res = _.find(challengeTasksChangedId[task.legacyId], function(arr){
                return arr[1] === task.challenge.id;
              });

              // If res, id changed, otherwise matches the original one
              task.challenge.taskId = res ? res[0] : task.legacyId;
            } else {
              task.challenge.taskId = task.legacyId;
            }
          }

          if(!task.type) console.log('Task without type ', task._id, ' user ', user._id);

          task = new TaskModel(task); // this should also fix dailies that wen to the habits array or vice-versa
          user.tasksOrder[task.type + 's'].push(task._id);
          tasksToSave++;
          batchInsertTasks.insert(task.toObject());
        });

        batchInsertUsers.insert((new NewUserModel(user)).toObject());
      });

      console.log('Saving', users.length, 'users and', tasksToSave, 'tasks');

      // Save in the background and dispatch another processUser();

      batchInsertUsers.execute(function(err, result){
        if(err) throw err // we can't simply accept errors
        console.log('Saved', result.nInserted, 'users')
      });

      batchInsertTasks.execute(function(err, result){
        if(err) throw err // we can't simply accept errors
        console.log('Saved', result.nInserted, 'tasks')
      });

      processed = processed + users.length;
      if(lastUser && lastUser._id){
        processUser(lastUser._id);
      } else {
        console.log('Done!');
      }
    });
};
*/

// Connect to the databases
const MongoClient = MongoDB.MongoClient;

Q.all([
  MongoClient.connect(MONGODB_OLD),
  MongoClient.connect(MONGODB_NEW),
])
.then(([oldInstance, newInstance]) => {
  mongoDbOldInstance = oldInstance;
  oldUserCollection = mongoDbOldInstance.collection('users');

  mongoDbNewInstance = newInstance;
  newUserCollection = mongoDbNewInstance.collection('users');
  newTaskCollection = mongoDbNewInstance.collection('tasks');

  console.log(`Connected with MongoClient to ${MONGODB_OLD} and ${MONGODB_NEW}.`);

  return processUser(nconf.get('USER_ID'));
})
.catch(err => {
  throw err;
});
