const twilio = require('twilio');
const Sequelize = require('sequelize');
const express = require('express');
const bodyParser = require('body-parser');
const _ = require('lodash');
const async = require('async');
const shortid = require('shortid');
const moment = require('moment-timezone');

// create sequelize models
const Person = require('./Person');
const Message = require('./Message');

const databaseURL = process.env.DATABASE_URL || 'postgres://tsheaff:admin@localhost/calmapi_test';
const dbConnection = new Sequelize(databaseURL, {
  logging: console.log,
  define: {
    updatedAt: 'updated_at',
    createdAt: 'created_at',
  },
});

const models = [ Person, Message ];
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
    return done('no phone number');
  }

  const cohort = moment().tz('America/Los_Angeles').format('YYYY-MM-DD');
  Person.create({
    id: shortid.generate(),
    phone_number: phoneNumber,
    cohort: cohort,
  }).then((result) => {
    const fallbackIntroMessage = 'Thanks for participating in MAGIC MAN. After the illusion is complete, your phone number will be deleted from our servers.';
    Message.findById('intro').then((introMessage) => {
      done(introMessage || fallbackIntroMessage);
    }).catch(() => {
      done(fallbackIntroMessage);
    });
  }).catch((err) => {
    console.log('error creating person', err);
    done('There was some sort of problem enrolling you in MAGIC MAN. Tell Kevin to get his shit together 💩');
  });
};

const changeIntroMessage = (introMessage, done) => {
  Message.upsert({
    type: 'intro',
    message: introMessage,
  }).then((result) => {
    done('Success, Intro Message is now "' + introMessage + '"');
  }).catch((error) => {
    done('There was some sort of problem updating the Intro Message. Tell Tyler to get his shit together 💩');
  });
};

const sendMessageToCohort = (message, cohort, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      return done('There was some sort of problem sending your message to cohort ' + cohort + '. Tell Tyler to get his shit together 💩');
    }
    // TODO: twilio message send loop
    done('Your message was sent to ' + _.size(people) + ' people in cohort ' + cohort);
  });
};

const listCohort = (cohort, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      return done('There was some sort of problem listing cohort ' + cohort + '. Tell Tyler to get his shit together 💩');
    }
    done('These are the members in cohort ' + cohort + ':\n' + phoneNumbers.join('\n'));
  });
};

const countCohort = (cohort, done) => {
  getCohortPhoneNumbers(cohort, (err, phoneNumbers) => {
    if (err) {
      return done('There was some sort of problem counting cohort ' + cohort + '. Tell Tyler to get his shit together 💩');
    }
    done('There are' + _.size(people) + ' people in cohort ' + cohort);
  });
};

const deleteCohort = (cohort, done) => {
  const cohortOptions = cohortSequelizeOptions(cohort);
  Person.destroy(cohortOptions).then((people) => {
    done('All' + _.size(people) + ' people in cohort ' + cohort + ' have been deleted');
  }).catch((error) => {
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
  }).catch((error) => {
    done(error);
  });
};

const executeTwilioMessage = (fullMessage, senderPhoneNumber, done) => {
  console.log('inside executeTwilioMessage', fullMessage, senderPhoneNumber);
  const words = fullMessage.split(' ');
  console.log('words', words);
  const firstWord = words.shift();
  console.log('firstWord', firstWord);
  const isAdminMessage = firstWord === 'COMMAND';
  console.log('isAdminMessage', isAdminMessage);
  if (!isAdminMessage) {
    console.log('  IS NOT ADMIN MESSAGE, ENROLLING', senderPhoneNumber);
    return enrollPersonInTodaysCohort(senderPhoneNumber, done);
  }

  const adminCommand = words.shift();
  console.log('adminCommand', adminCommand);
  if (adminCommand === 'CHANGE-INTRO') {
    const message = words.join(' ');
    return changeIntroMessage(message, done);
  }

  const cohort = words.shift();
  const cohortIsValid = cohort === 'ALL' || cohort.match(/\d\d\d\d-\d\d-\d\d/);
  if (!cohortIsValid) {
    return done('invalid cohort "' + cohort + '". Cohort must me either "ALL" or like "YYYY-MM-DD" for example "2018-05-09"');
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
  return done('invalid command');
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
