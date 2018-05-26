const twilio = require('twilio');
const Sequelize = require('sequelize');
const express = require('express');
const bodyParser = require('body-parser');
const _ = require('lodash');
const async = require('async');
const shortid = require('shortid');
const moment = require('moment-timezone');
const CONFIG = require('./config');

// create twilio client
var TwilioSID = process.env.TWILIO_SID;
var TwilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
var twilioClient = new twilio(TwilioSID, TwilioAuthToken);

// create sequelize models
const Person = require('./Person');

const databaseURL = process.env.DATABASE_URL;
const dbConnection = new Sequelize(databaseURL, {
  logging: console.log,
  define: {
    updatedAt: 'updated_at',
    createdAt: 'created_at',
    deletedAt: 'deleted_at',
  },
});

const models = [ Person ];
_.forEach(models, (model) => {
  model.init(model.fields(), {
    sequelize: dbConnection,
    tableName: model.tableName(),
    paranoid: true,
  });
  model.sync();
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
  Person.find({ where: {
    phone_number: phoneNumber,
    cohort: cohort
  }}).then((person) => {
    if (person) {
      return done(CONFIG.ALREADY_ENROLLED);
    }

    Person.create({
      id: shortid.generate(),
      phone_number: phoneNumber,
      cohort: cohort,
    }).then((result) => {
      done(CONFIG.ENROLLMENT_SUCCESS);
    }).catch((err) => {
      console.log('Error Creating Person: ', err);
      done(CONFIG.ENROLLMENT_ERROR);
    });
  }).catch((err) => {
    console.log('Error Finding Person: ', err);
    done(CONFIG.ENROLLMENT_ERROR);
  });
};

const sendMessageToCohort = (message, cohort, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      console.log('Error Sending Message: ', err);
      return done(`There was some sort of problem sending your message to cohort ${cohort}. ${CONFIG.COMMAND_ERROR_SUFFIX}`);
    }
    // TODO: twilio message send loop
    done(`Your message was sent to ${_.size(phoneNumbers)} people in cohort ${cohort}`);
  });
};

const listCohort = (cohort, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      console.log('Error Listing Cohort: ', err);
      return done(`There was some sort of problem listing cohort ${cohort}. ${CONFIG.COMMAND_ERROR_SUFFIX}`);
    }
    if (_.size(phoneNumbers) === 0) {
      return done(`There are no people in cohort ${cohort}`);
    }
    done(`These are the members in cohort ${cohort}:\n${phoneNumbers.join('\n')}`);
  });
};

const countCohort = (cohort, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      console.log('Error Counting Cohort: ', err);
      return done(`There was some sort of problem counting cohort ${cohort}. ${CONFIG.COMMAND_ERROR_SUFFIX}`);
    }
    const numPeople = _.size(phoneNumbers);
    const isPlural = numPeople !== 1;
    const isOrAre = isPlural ? 'are' : 'is';
    const personOrPeople = isPlural ? 'people' : 'person';
    done(`There ${isOrAre} ${numPeople} ${personOrPeople} in cohort ${cohort}`);
  });
};

const deleteCohort = (cohort, done) => {
  const cohortOptions = cohortSequelizeOptions(cohort);
  Person.destroy(cohortOptions).then((numDestroyed) => {
    done(`All ${numDestroyed} people in cohort ${cohort} have been deleted`);
  }).catch((err) => {
    console.log('Error Deleting Cohort: ', err);
    done(`There was some sort of problem deleting cohort ${cohort}. ${CONFIG.COMMAND_ERROR_SUFFIX}`);
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

const executeTwilioMessage = (fullMessage, phoneNumber, done) => {
  if (!fullMessage || !phoneNumber) {
    return done(CONFIG.ENROLLMENT_ERROR);
  }
  const words = fullMessage.split(' ');
  const firstWord = words.shift();
  const isAdminMessage = firstWord === 'COMMAND';
  if (!isAdminMessage) {
    const lowerCaseMessage = _.lowerCase(fullMessage.trim());
    const isEnrollmentConfirmation = _.includes(CONFIG.VALID_ENROLLMENTS, lowerCaseMessage);
    if (isEnrollmentConfirmation) {
      return enrollPersonInTodaysCohort(phoneNumber, done);
    }
    return done(CONFIG.INTRO);
  }

  const adminCommand = words.shift();
  if (!adminCommand) {
    return done('Please give MAGIC MAN a valid command. For example "COMMAND COUNT 2018-05-09"');
  }

  const cohort = words.shift();
  if (!cohort) {
    return done('Please give MAGIC MAN a valid command. For example "COMMAND COUNT 2018-05-09"');
  }
  const cohortIsValid = cohort === 'ALL' || cohort.match(/\d\d\d\d-\d\d-\d\d/);
  if (!cohortIsValid) {
    return done(`Please give MAGIC MAN a valid cohort. "${cohort}" is invalid. Cohort must me either "ALL" or like "YYYY-MM-DD" for example "2018-05-09"`);
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

const sendTwilioMessage = (message, toPhoneNumber, fromPhoneNumber, done) => {
  twilioClient.messages.create({
    body: message,
    to: toPhoneNumber,
    from: fromPhoneNumber,
  }).then((message) => {
    console.log('Sent Twilio Message', message);
    done();
  }).catch((err) => {
    console.log('Error Sending Twilio Message', err);
    done(err);
  });
};

// endpoints
app.post('/twilio/webook', (req, res) => {
  console.log('twilio webhook body', req.body);
  const message = req.body.Body;
  const fromPhoneNumber = req.body.From;
  const toPhoneNumber = req.body.To;
  executeTwilioMessage(message, fromPhoneNumber, (response) => {
    sendTwilioMessage(response, fromPhoneNumber, toPhoneNumber, () => {
      res.status(200);
      res.json({});
    });
  })
});

app.post('/twilio/test', (req, res) => {
  const message = req.body.message;
  const phoneNumber = req.body.phone_number;
  executeTwilioMessage(message, phoneNumber, (response) => {
    res.send(response);
  })
});

// start server
const port = parseInt(process.env.PORT, 10) || 8080;
app.listen(port, () => {
  console.log('server started', { port: port });
});
