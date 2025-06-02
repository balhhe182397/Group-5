const express = require('express');
const router = express.Router();
const db = require('../config/database');
const transporter = require('../config/email');

// Function to send overdue notification email
async function sendOverdueNotification(user, book, daysOverdue) {
    const mailOptions = {
        from: 'nguyenvanhoitgm@gmail.com',
        to: user.email,
        subject: 'Thông báo sách quá hạn mượn',
        html: `
            <h2>Thông báo sách quá hạn mượn</h2>
            <p>Kính gửi ${user.full_name},</p>
            <p>Chúng tôi thông báo rằng bạn đang có sách quá hạn mượn:</p>
            <ul>
                <li>Tên sách: ${book.title}</li>
                <li>Ngày hết hạn: ${new Date(book.due_date).toLocaleDateString('vi-VN')}</li>
                <li>Số ngày quá hạn: ${daysOverdue} ngày</li>
                <li>Tiền phạt hiện tại: ${(daysOverdue * 5000).toLocaleString('vi-VN')} VND</li>
            </ul>
            <p>Vui lòng trả sách càng sớm càng tốt để tránh phạt thêm.</p>
            <p>Trân trọng,<br>Thư viện</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Overdue notification sent to ${user.email}`);
    } catch (error) {
        console.error('Error sending overdue notification:', error);
    }
}

// Function to check and send notifications for overdue books
async function checkOverdueBooks() {
    try {
        const [overdueBooks] = await db.execute(`
            SELECT b.*, u.email, u.full_name, bk.title
            FROM borrows b
            JOIN users u ON b.user_id = u.id
            JOIN books bk ON b.book_id = bk.id
            WHERE b.status = 'borrowed'
            AND b.due_date < CURRENT_TIMESTAMP
            AND (b.last_notification_date IS NULL OR b.last_notification_date < CURRENT_DATE)
        `);

        console.log(`Found ${overdueBooks.length} overdue books`);

        for (const book of overdueBooks) {
            const daysOverdue = Math.ceil((new Date() - new Date(book.due_date)) / (1000 * 60 * 60 * 24));
            await sendOverdueNotification(
                { email: book.email, full_name: book.full_name },
                { title: book.title, due_date: book.due_date },
                daysOverdue
            );

            // Update last notification date
            await db.execute(
                'UPDATE borrows SET last_notification_date = CURRENT_DATE WHERE id = ?',
                [book.id]
            );
        }
    } catch (error) {
        console.error('Error checking overdue books:', error);
    }
}

// Schedule the check to run every hour
setInterval(checkOverdueBooks, 60 * 60 * 1000);

// Run the check immediately when the server starts
checkOverdueBooks();

module.exports = router; 