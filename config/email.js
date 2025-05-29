const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'nguyenvanhoitgm@gmail.com',
        pass: 'hhmi hmpe ttcy afgz'
    }
});

module.exports = transporter; 