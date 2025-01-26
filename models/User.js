const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    coins: { type: Number, default: 100 },
    active: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', userSchema);
