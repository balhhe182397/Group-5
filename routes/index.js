const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');

// Homepage
router.get('/', async (req, res) => {
    try {
        // Get recent books
        const [recentBooks] = await db.execute(`
            SELECT * FROM books 
            ORDER BY created_at DESC 
            LIMIT 6
        `);

        // Get popular books (most borrowed)
        const [popularBooks] = await db.execute(`
            SELECT b.*, COUNT(br.id) as borrow_count 
            FROM books b 
            LEFT JOIN borrows br ON b.id = br.book_id 
            GROUP BY b.id 
            ORDER BY borrow_count DESC 
            LIMIT 6
        `);

        res.render('index', {
            recentBooks,
            popularBooks
        });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading homepage');
        res.render('index', {
            recentBooks: [],
            popularBooks: []
        });
    }
});

// Contact page
router.get('/contact', (req, res) => {
    res.render('contact', {
        user: req.session.user
    });
});

// Dashboard chung cho user và admin
router.get('/dashboard', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    const db = require('../config/database');
    try {
        if (user.role === 'admin') {
            // Lấy thống kê cho admin
            const [totalBooks] = await db.query('SELECT COUNT(*) as count FROM books');
            const [activeBorrows] = await db.query('SELECT COUNT(*) as count FROM borrows WHERE return_date IS NULL');
            const [pendingVerifications] = await db.query('SELECT COUNT(*) as count FROM users WHERE is_verified = FALSE');
            const [totalUsers] = await db.query('SELECT COUNT(*) as count FROM users');
            const stats = {
                totalBooks: totalBooks[0].count,
                activeBorrows: activeBorrows[0].count,
                pendingVerifications: pendingVerifications[0].count,
                totalUsers: totalUsers[0].count
            };
            return res.render('dashboard', { user, stats, borrows: null, userStats: null });
        } else {
            // Lấy thông tin cá nhân và sách đã mượn cho user
            const [userInfo] = await db.query('SELECT * FROM users WHERE id = ?', [user.id]);
            const [borrows] = await db.query(`
                SELECT b.*, books.title, books.author, books.cover_image
                FROM borrows b
                JOIN books ON b.book_id = books.id
                WHERE b.user_id = ?
                ORDER BY b.created_at DESC
                LIMIT 10
            `, [user.id]);
            // Thống kê
            const [[totalBorrows]] = await db.query('SELECT COUNT(*) as count FROM borrows WHERE user_id = ?', [user.id]);
            const [[returned]] = await db.query("SELECT COUNT(*) as count FROM borrows WHERE user_id = ? AND status = 'returned'", [user.id]);
            const [[borrowing]] = await db.query("SELECT COUNT(*) as count FROM borrows WHERE user_id = ? AND status = 'borrowed'", [user.id]);
            // Tổng tiền phạt thực tế (tính lại từ bảng borrows và payments)
            // Tính tổng số ngày trễ thực tế
            const [lateRows] = await db.query(`
                SELECT b.id, b.due_date, b.return_date, b.status
                FROM borrows b
                WHERE b.user_id = ?
            `, [user.id]);
            let totalLateDays = 0;
            for (const b of lateRows) {
                let daysLate = 0;
                if (b.due_date && b.status !== 'returned') {
                    const now = new Date();
                    const due = new Date(b.due_date);
                    if (now > due) {
                        daysLate = Math.ceil((now - due) / (1000 * 60 * 60 * 24));
                    }
                } else if (b.due_date && b.return_date && b.return_date > b.due_date) {
                    const due = new Date(b.due_date);
                    const returned = new Date(b.return_date);
                    daysLate = Math.ceil((returned - due) / (1000 * 60 * 60 * 24));
                }
                totalLateDays += daysLate;
            }
            const totalFine = totalLateDays * 5000;
            // Đã thanh toán
            const [[paidFine]] = await db.query(`
                SELECT IFNULL(SUM(amount),0) as sum
                FROM payments p
                JOIN borrows b ON p.borrow_id = b.id
                WHERE b.user_id = ? AND p.status = 'paid'
            `, [user.id]);
            // Đang nợ (tổng nợ thực tế - đã thanh toán)
            const unpaidFine = Math.max(0, totalFine - paidFine.sum);
            const userStats = {
                totalBorrows: totalBorrows.count,
                returned: returned.count,
                borrowing: borrowing.count,
                totalFine: totalFine,
                paidFine: paidFine.sum,
                unpaidFine: unpaidFine
            };
            return res.render('dashboard', { user: userInfo[0], stats: null, borrows, userStats });
        }
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading dashboard');
        res.redirect('/');
    }
});

module.exports = router; 