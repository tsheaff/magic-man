const Sequelize = require('sequelize');
const DataTypes = Sequelize.DataTypes;

class Person extends Sequelize.Model {
  static tableName() {
    return 'people'
  }

  static fields() {
    return {
      id: {
        type: DataTypes.TEXT,
        primaryKey: true,
      },
      phone_number: {
        type: DataTypes.TEXT,
        unique: 'phone_number_cohort_index',
      },
      cohort: {
        type: DataTypes.TEXT, // formatted like YYYY.MM.DD
        unique: 'phone_number_cohort_index',
      },
    };
  }
}

module.exports = Person;