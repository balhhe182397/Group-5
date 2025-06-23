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
            // Tổng tiền phạt thực tế
            const [[totalFine]] = await db.query(`
                SELECT IFNULL(SUM(
                    CASE 
                        WHEN status IN ('borrowed', 'overdue') AND due_date < CURRENT_TIMESTAMP THEN DATEDIFF(CURRENT_TIMESTAMP, due_date) * 5000
                        WHEN status = 'returned' AND due_date < return_date THEN DATEDIFF(return_date, due_date) * 5000
                        ELSE fine_amount 
                    END
                ),0) as sum
                FROM borrows WHERE user_id = ?
            `, [user.id]);
            // Đã thanh toán
            const [[paidFine]] = await db.query(`
                SELECT IFNULL(SUM(
                    CASE 
                        WHEN status IN ('borrowed', 'overdue') AND due_date < CURRENT_TIMESTAMP THEN DATEDIFF(CURRENT_TIMESTAMP, due_date) * 5000
                        WHEN status = 'returned' AND due_date < return_date THEN DATEDIFF(return_date, due_date) * 5000
                        ELSE fine_amount 
                    END
                ),0) as sum
                FROM borrows WHERE user_id = ? AND payment_status = 'paid'
            `, [user.id]);
            // Đang nợ
            const [[unpaidFine]] = await db.query(`
                SELECT IFNULL(SUM(
                    CASE 
                        WHEN status IN ('borrowed', 'overdue') AND due_date < CURRENT_TIMESTAMP THEN DATEDIFF(CURRENT_TIMESTAMP, due_date) * 5000
                        WHEN status = 'returned' AND due_date < return_date THEN DATEDIFF(return_date, due_date) * 5000
                        ELSE fine_amount 
                    END
                ),0) as sum
                FROM borrows WHERE user_id = ? AND (payment_status = 'pending' OR payment_status IS NULL OR payment_status = '')
            `, [user.id]);
            const userStats = {
                totalBorrows: totalBorrows.count,
                returned: returned.count,
                borrowing: borrowing.count,
                totalFine: totalFine.sum,
                paidFine: paidFine.sum,
                unpaidFine: unpaidFine.sum
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