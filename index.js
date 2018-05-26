const twilio = require('twilio');
const Sequelize = require('sequelize');
const express = require('express');
const bodyParser = require('body-parser');
const _ = require('lodash');
const async = require('async');
const shortid = require('shortid');
const moment = require('moment-timezone');
const CONFIG = require('./config');

// create sequelize models
const Person = require('./Person');

const databaseURL = process.env.DATABASE_URL || 'postgres://tsheaff:admin@localhost/calmapi_test';
const dbConnection = new Sequelize(databaseURL, {
  logging: console.log,
  define: {
    updatedAt: 'updated_at',
    createdAt: 'created_at',
  },
});

const models = [ Person ];
_.forEach(models, (model) => {
  model.init(model.fields(), {
    sequelize: dbConnection,
    tableName: model.tableName(),
    paranoid: true,
  });
});

// create express app
const app = express();
app.set('json spaces', 2);

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: false }));

// message helpers
const enrollPersonInTodaysCohort = (phoneNumber, done) => {
  if (!phoneNumber) {
    console.log('Error Creating Person: no phone number');
    return done(CONFIG.ENROLLMENT_ERROR);
  }

  const cohort = moment().tz('America/Los_Angeles').format('YYYY-MM-DD');
  Person.create({
    id: shortid.generate(),
    phone_number: phoneNumber,
    cohort: cohort,
  }).then((result) => {
    done();
  }).catch((err) => {
    console.log('Error Creating Person: ', err);
    done(CONFIG.ENROLLMENT_ERROR);
  });
};

const sendMessageToCohort = (message, cohort, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      console.log('Error Sending Message: ', err);
      return done('There was some sort of problem sending your message to cohort ' + cohort + '. Tell Tyler to get his shit together 💩');
    }
    // TODO: twilio message send loop
    done('Your message was sent to ' + _.size(people) + ' people in cohort ' + cohort);
  });
};

const listCohort = (cohort, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      console.log('Error Listing Cohort: ', err);
      return done('There was some sort of problem listing cohort ' + cohort + '. Tell Tyler to get his shit together 💩');
    }
    done('These are the members in cohort ' + cohort + ':\n' + phoneNumbers.join('\n'));
  });
};

const countCohort = (cohort, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      console.log('Error Counting Cohort: ', err);
      return done('There was some sort of problem counting cohort ' + cohort + '. Tell Tyler to get his shit together 💩');
    }
    done('There are' + _.size(people) + ' people in cohort ' + cohort);
  });
};

const deleteCohort = (cohort, done) => {
  const cohortOptions = cohortSequelizeOptions(cohort);
  Person.destroy(cohortOptions).then((people) => {
    done('All' + _.size(people) + ' people in cohort ' + cohort + ' have been deleted');
  }).catch((err) => {
    console.log('Error Deleting Cohort: ', err);
    done('There was some sort of problem deleting cohort ' + cohort + '. Tell Tyler to get his shit together 💩');
  });
};

const cohortSequelizeOptions = (cohort) => {
  if (cohort === 'ALL') {
    return;
  }
  return { where: { cohort: cohort } };
}

const getCohortPhoneNumbers = (cohort, done) => {
  const cohortOptions = cohortSequelizeOptions(cohort);
  Person.findAll(cohortOptions).then((people) => {
    const phoneNumbers = _.sortBy(_.map(people, 'phone_number'));
    done(null, phoneNumbers);
  }).catch((err) => {
    done(err);
  });
};

const executeTwilioMessage = (fullMessage, senderPhoneNumber, done) => {
  const words = fullMessage.split(' ');
  const firstWord = words.shift();
  const isAdminMessage = firstWord === 'COMMAND';
  if (!isAdminMessage) {
    const lowerCaseMessage = _.lowerCase(fullMessage.trim());
    const isEnrollmentConfirmation = _.includes(CONFIG.VALID_ENROLLMENTS, lowerCaseMessage);
    if (isEnrollmentConfirmation) {
      return enrollPersonInTodaysCohort(senderPhoneNumber, done);
    }
    return done(CONFIG.INTRO);
  }

  const adminCommand = words.shift();
  const cohort = words.shift();
  const cohortIsValid = cohort === 'ALL' || cohort.match(/\d\d\d\d-\d\d-\d\d/);
  if (!cohortIsValid) {
    return done('Invalid cohort "' + cohort + '". Cohort must me either "ALL" or like "YYYY-MM-DD" for example "2018-05-09"');
  }

  if (adminCommand === 'SEND') {
    const message = words.join(' ');
    return sendMessageToCohort(message, cohort, done);
  }
  if (adminCommand === 'LIST') {
    return listCohort(cohort, done);
  }
  if (adminCommand === 'COUNT') {
    return countCohort(cohort, done);
  }
  if (adminCommand === 'DELETE') {
    return deleteCohort(cohort, done);
  }
  return done('You gave MAGIC MAN an invalid command. Valid commands are SEND, LIST, COUNT and DELETE');
};

// endpoints
app.get('/twilio/webook', (req, res) => {
  const message = req.body.message;
  const senderPhoneNumber = req.body.sender_phone_number;
  executeTwilioMessage(message, senderPhoneNumber, (response) => {
    twilio.send(response, senderPhoneNumber);
  })
});

app.post('/twilio/test', (req, res) => {
  const message = req.body.message;
  const senderPhoneNumber = req.body.phone_number;
  executeTwilioMessage(message, senderPhoneNumber, (response) => {
    res.json({ response: response });
  })
});

// start server
const port = parseInt(process.env.PORT, 10) || 8080;
app.listen(port, () => {
  console.log('server started', { port: port });
});