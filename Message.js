const Sequelize = require('sequelize');
const DataTypes = Sequelize.DataTypes;

class Message extends Sequelize.Model {
  static tableName() {
    return 'messages'
  }

  static fields() {
    return {
      type: {
        type: DataTypes.TEXT,
        primaryKey: true,
      },
      message: {
        type: DataTypes.TEXT,
      },  
    };
  }
}

module.exports = Message;