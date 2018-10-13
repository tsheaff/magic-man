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
    paranoid: false,
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

  const cohort = moment().tz('America/Los_Angeles').format('YYYY.MM.DD');
  Person.create({
    id: shortid.generate(),
    phone_number: phoneNumber,
    cohort: cohort,
  }).then((result) => {
    done(CONFIG.ENROLLMENT_SUCCESS);
  }).catch((err) => {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return done(CONFIG.ALREADY_ENROLLED);
    }
    console.log('Error Creating Person: ', err);
    done(CONFIG.ENROLLMENT_ERROR);
  });
};

const sendMessageToCohort = (cohort, message, mediaURL, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      console.log('Error Sending Message: ', err);
      return done(`There was some sort of problem sending your message to cohort ${cohort}. ${CONFIG.COMMAND_ERROR_SUFFIX}`);
    }
    async.each(_.uniq(phoneNumbers), (phoneNumber, done) => {
      sendTwilioMessage(message, mediaURL, phoneNumber, process.env.TWILIO_PHONE_NUMBER, done);
    }, (twilioSendErr) => {
      if (twilioSendErr) {
        return done(`There was some sort of problem sending your message to cohort ${cohort}. ${CONFIG.COMMAND_ERROR_SUFFIX}`);
      }
      done(`Your message was SUCCESSFULLY sent to ${_.size(phoneNumbers)} people in cohort ${cohort}`);
    });
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
  const options = (() => {
    if (cohort === 'all') {
      return { truncate: true };
    }
    return { where: { cohort: cohort } };
  })();
  Person.destroy(options).then((numDestroyed) => {
    done(`All ${numDestroyed} people in cohort ${cohort} have been deleted`);
  }).catch((err) => {
    console.log('Error Deleting Cohort: ', err);
    done(`There was some sort of problem deleting cohort ${cohort}. ${CONFIG.COMMAND_ERROR_SUFFIX}`);
  });
};

const getCohortPhoneNumbers = (cohort, done) => {
  const options = (() => {
    if (cohort === 'all') {
      return;
    }
    return { where: { cohort: cohort } };
  })();
  Person.findAll(options).then((people) => {
    const phoneNumbers = _.sortBy(_.map(people, 'phone_number'));
    done(null, phoneNumbers);
  }).catch((err) => {
    done(err);
  });
};

const executeTwilioMessage = (fullMessage, phoneNumber, mediaURL, done) => {
  if (!fullMessage || !phoneNumber) {
    return done(CONFIG.ENROLLMENT_ERROR);
  }
  const words = fullMessage.split(' ');
  const firstWord = words.shift().toLowerCase().trim();
  const isAdminMessage = firstWord === 'command';
  if (!isAdminMessage) {
    const lowerCaseMessage = fullMessage.toLowerCase().trim();
    const validEnrollments = CONFIG.VALID_ENROLLMENTS.split(',');
    const isEnrollmentConfirmation = _.includes(validEnrollments, lowerCaseMessage);
    if (isEnrollmentConfirmation) {
      return enrollPersonInTodaysCohort(phoneNumber, done);
    }
    return done(); // no message in this case
  }

  let adminCommand = words.shift();
  if (!adminCommand) {
    return done('Please give MAGIC MAN a valid command. For example "command count 2018.05.09"');
  }
  adminCommand = adminCommand.toLowerCase().trim();

  const validCommandPhoneNumbers = process.env.COMMAND_NUMBERS.split(',');
  const hasCommandAuth = _.includes(validCommandPhoneNumbers, phoneNumber);
  if (!hasCommandAuth) {
    return done('You do not have the power to command MAGIC MAN. Sacrifice a goat and he may elevate your privileges 🙏');
  }

  let cohort = words.shift();
  if (!cohort) {
    return done('Please give MAGIC MAN a valid command. For example "command count 2018.05.09"');
  }
  cohort = cohort.toLowerCase().trim();
  const cohortIsValid = cohort === 'all' || cohort.match(/\d\d\d\d\.\d\d\.\d\d/);
  if (!cohortIsValid) {
    return done(`Please give MAGIC MAN a valid cohort. "${cohort}" is invalid. Cohort must be either "all" or "YYYY.MM.DD" e.g. "2018.05.09"`);
  }

  if (adminCommand === 'send') {
    const message = words.join(' ');
    return sendMessageToCohort(cohort, message, mediaURL, done);
  }
  if (adminCommand === 'list') {
    return listCohort(cohort, done);
  }
  if (adminCommand === 'count') {
    return countCohort(cohort, done);
  }
  if (adminCommand === 'delete') {
    return deleteCohort(cohort, done);
  }
  return done('You gave MAGIC MAN an invalid command. Valid commands are "send", "list", "count" and "delete"');
};

const sendTwilioMessage = (message, mediaURL, toPhoneNumber, fromPhoneNumber, done) => {
  const options = {
    body: message,
    to: toPhoneNumber,
    from: fromPhoneNumber,
    mediaUrl: mediaURL,
  };
  twilioClient.messages.create(options).then((message) => {
    console.log('Sent Twilio Message', options);
    done();
  }).catch((err) => {
    console.log('Error Sending Twilio Message', options, err);
    done(err);
  });
};

// endpoints
app.post('/twilio/webook', (req, res) => {
  const message = req.body.Body;
  const fromPhoneNumber = req.body.From;
  const toPhoneNumber = req.body.To;
  const mediaURL = req.body.MediaUrl0;
  console.log('Received Twilio Message', {
    message: message,
    to: toPhoneNumber,
    from: fromPhoneNumber,
    mediaURL: mediaURL,
  });
  const succeed = () => {
    res.status(200);
    res.json({});
  };
  executeTwilioMessage(message, fromPhoneNumber, mediaURL, (response) => {
    if (!response) {
      return succeed();
    }
    sendTwilioMessage(response, undefined, fromPhoneNumber, toPhoneNumber, () => {
      succeed();
    });
  });
});

app.post('/twilio/test', (req, res) => {
  const message = req.body.message;
  const phoneNumber = req.body.phone_number;
  const mediaURL = req.body.media_url;
  executeTwilioMessage(message, phoneNumber, mediaURL, (response) => {
    res.send(response);
  })
});

// start server
const port = parseInt(process.env.PORT, 10) || 8080;
app.listen(port, () => {
  console.log('server started', { port: port });
});
