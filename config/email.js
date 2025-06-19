const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'nguyenvanhoitgm@gmail.com',
        pass: 'hhmi hmpe ttcy afgz'
    }
});

async function sendEmail(to, subject, html) {
    const mailOptions = {
        from: 'nguyenvanhoitgm@gmail.com',
        to,
        subject,
        html
    };
    return transporter.sendMail(mailOptions);
}

module.exports = { transporter, sendEmail }; 