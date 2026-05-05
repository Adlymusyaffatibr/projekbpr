const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");

const app = express();
const PORT = process.env.PORT || 3000;

function sanitizeFilename(str) {
    return str.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));

const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Session middleware
app.use(
    session({
        secret: "your-secret-key-here",
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }, // true jika menggunakan HTTPS
    }),
);

// Database connection
// const db = mysql.createConnection({
//     host: "localhost",
//     user: "root",
//     password: "",
//     database: "login_app",
// });

const db = mysql.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT
});

db.connect((err) => {
    if (err) {
        console.error("Database connection failed:", err);
        return;
    }
    console.log("✅ Connected to MySQL database");
});

// JWT Secret
const JWT_SECRET = "your-jwt-secret-key";

// ================= LOGIN =================

// Halaman Login
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// API Login
app.post("/api/login", async(req, res) => {
    const { username, password } = req.body;

    try {
        const [rows] = await db.promise().execute("SELECT * FROM users WHERE username = ? OR email = ?", [username, username]);

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Username/Email atau password salah!",
            });
        }

        const user = rows[0];

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Username/Email atau password salah!",
            });
        }

        const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "1h" });

        res.cookie("token", token, {
            httpOnly: true,
            secure: true,
            sameSite: "none"
        });

        res.json({
            success: true,
            message: "Login berhasil!",
            user: user,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error!" });
    }
});

// ================= AUTH =================

const authenticateToken = (req, res, next) => {
    let token = req.cookies.token;

    if (!token && req.headers["authorization"]) {
        token = req.headers["authorization"].split(" ")[1];
    }

    if (!token) {
        console.log("❌ TOKEN KOSONG");
        return res.status(401).json({ success: false, message: "Access denied!" });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.log("❌ TOKEN INVALID");
            return res.status(403).json({ success: false, message: "Token invalid!" });
        }
        req.user = user;
        next();
    });
};

// ================= DASHBOARD =================

app.get("/dashboard", authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ================= LOGOUT =================

app.post("/api/logout", (req, res) => {
    req.session.destroy();
    res.clearCookie("token");
    res.json({ success: true, message: "Logout berhasil!" });
});

// ================= CEK AUTH =================

app.get("/api/check-auth", authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: req.user,
    });
});

// ================= HASH DEBUG =================

bcrypt.hash("password123", 10).then((hash) => {
    console.log("HASH BARU:", hash);
});

// ================= LAPORAN =================

// GET
async function updateExpiredStatus() {
    try {
        const today = new Date().toISOString().slice(0, 10);
        // Ubah status menjadi 'Tidak Berlaku' jika expired_date < hari ini dan status masih 'Berlaku'
        await db.promise().execute("UPDATE laporan SET status = 'Tidak Berlaku' WHERE expiry_date IS NOT NULL AND expiry_date < ? AND status = 'Berlaku'", [today]);
        // Kembalikan status menjadi 'Berlaku' jika expired_date >= hari ini
        await db.promise().execute("UPDATE laporan SET status = 'Berlaku' WHERE expiry_date IS NOT NULL AND expiry_date >= ? AND status = 'Tidak Berlaku'", [today]);
    } catch (err) {
        console.error("Gagal update status expired:", err);
    }
}

app.get("/api/laporan", authenticateToken, async(req, res) => {
    await updateExpiredStatus();
    const { tahun, bulan } = req.query;

    try {
        let query = "SELECT * FROM laporan WHERE 1=1";
        let params = [];

        if (tahun) {
            query += " AND tahun = ?";
            params.push(tahun);
        }

        if (bulan !== undefined && bulan !== "") {
            query += " AND bulan = ?";
            params.push(bulan);
        }

        const [rows] = await db.promise().execute(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= SEARCH LAPORAN (untuk user) =================
app.get("/api/laporan/search", authenticateToken, async(req, res) => {
    const { tgl, uu, sop, perihal } = req.query;

    if (!tgl || !uu || !sop) {
        return res.status(400).json({ error: "Parameter tgl, uu, sop wajib diisi" });
    }

    try {
        let sql = "SELECT * FROM laporan WHERE tgl = ? AND LOWER(uu) = LOWER(?) AND LOWER(sop) = LOWER(?)";
        let params = [tgl, uu, sop];

        // Jika perihal diisi, tambahkan filter
        if (perihal && perihal.trim() !== "") {
            sql += " AND LOWER(perihal) = LOWER(?)";
            params.push(perihal);
        }

        const [rows] = await db.promise().execute(sql, params);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Laporan tidak ditemukan" });
        }

        res.json(rows[0]); // tetap kirim satu laporan pertama (kombinasi dianggap unik)
    } catch (err) {
        console.error("Search error:", err);
        res.status(500).json({ error: err.message });
    }
});

// INSERT
app.post("/api/laporan", authenticateToken, async(req, res) => {
    const { tahun, bulan, nama, tgl, status } = req.body;

    try {
        console.log("INSERT:", req.body);

        await db.promise().execute("INSERT INTO laporan (tahun, bulan, nama, tgl, status) VALUES (?, ?, ?, ?, ?)", [tahun, bulan, nama, tgl, status]);

        res.json({ success: true });
    } catch (err) {
        console.log("ERROR INSERT:", err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE
app.delete("/api/laporan/:id", authenticateToken, async(req, res) => {
    try {
        console.log("DELETE ID:", req.params.id);

        await db.promise().execute("DELETE FROM laporan WHERE id = ?", [req.params.id]);

        res.json({ success: true });
    } catch (err) {
        console.log("ERROR DELETE:", err);
        res.status(500).json({ error: err.message });
    }
});

// UPDATE STATUS
app.put("/api/laporan/:id", authenticateToken, async(req, res) => {
    const { nama, tgl, status } = req.body;

    try {
        let fields = [];
        let values = [];

        if (nama) {
            fields.push("nama = ?");
            values.push(nama);
        }

        if (tgl) {
            fields.push("tgl = ?");
            values.push(tgl);
        }

        if (status) {
            fields.push("status = ?");
            values.push(status);
        }

        values.push(req.params.id);

        await db.promise().execute(`UPDATE laporan SET ${fields.join(", ")} WHERE id = ?`, values);

        res.json({ success: true });
    } catch (err) {
        console.log("ERROR UPDATE:", err);
        res.status(500).json({ error: err.message });
    }
});

app.put("/api/laporan/:id/status", authenticateToken, async(req, res) => {
    const { status } = req.body;

    try {
        await db.promise().execute("UPDATE laporan SET status = ? WHERE id = ?", [status, req.params.id]);

        res.json({ success: true });
    } catch (err) {
        console.log("ERROR UPDATE STATUS:", err);
        res.status(500).json({ error: err.message });
    }
});

// ================= START SERVER =================

// ... kode awal Anda (express, db, dll tetap sama)

// Buat folder uploads jika belum ada (sudah ada)

// Konfigurasi penyimpanan file (SAMA)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/uploads/");
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    },
});

// UBAH LIMIT MENJADI 100MB
const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// ========= FUNGSI KOMPRESI PDF =========
async function compressPDF(inputPath, outputPath) {
    try {
        // Baca file asli
        const pdfBytes = fs.readFileSync(inputPath);
        // Muat dokumen
        const pdfDoc = await PDFDocument.load(pdfBytes);

        // Buat dokumen baru untuk hasil kompresi
        const compressedDoc = await PDFDocument.create();

        // Salin semua halaman ke dokumen baru (proses kompresi otomatis terjadi)
        const pages = await compressedDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
        for (const page of pages) {
            compressedDoc.addPage(page);
        }

        // Simpan dengan opsi kompresi (default sudah kompres)
        const compressedBytes = await compressedDoc.save();

        // Tulis file hasil kompres
        fs.writeFileSync(outputPath, compressedBytes);

        // Hitung ukuran baru
        const stats = fs.statSync(outputPath);
        console.log(`✅ PDF terkompres: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        return true;
    } catch (err) {
        console.error("❌ Gagal kompres PDF:", err);
        return false;
    }
}

// Endpoint untuk menambah laporan + PDF (dengan kompresi otomatis)
// Fungsi pembantu untuk membersihkan tanggal (letakkan di atas kedua endpoint)
// Fungsi pembantu untuk membersihkan tanggal (letakkan di atas kedua endpoint)
function sanitizeDate(dateStr) {
    if (!dateStr) return null;
    // Jika sudah dalam format YYYY-MM-DD, langsung return
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // Pisahkan dari format ISO atau datetime (misal "2026-05-04T14:01:02.000Z" atau "2026-05-04 14:01:02")
    let clean = dateStr.split("T")[0].split(" ")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    return null; // tidak valid
}

// Endpoint INSERT dengan PDF
app.post("/api/laporan/with-pdf", authenticateToken, upload.single("pdf"), async(req, res) => {
    let { tahun, bulan, nama, tgl, status, uu, sop, perihal, expiry_date } = req.body;
    expiry_date = sanitizeDate(expiry_date);
    let file_pdf = null;

    if (req.file) {
        const originalPath = req.file.path;
        const fileExt = ".pdf";
        const sanitizedUu = sanitizeFilename(uu || "uu");
        const sanitizedSop = sanitizeFilename(sop || "sop");
        const sanitizedPerihal = sanitizeFilename(perihal || "perihal");
        const timestamp = Date.now();
        const newFilename = `${tgl}_DIV${sanitizedUu}_KEP${sanitizedSop}_PER${sanitizedPerihal}_${timestamp}${fileExt}`;
        const newPath = path.join(__dirname, "public/uploads", newFilename);

        fs.renameSync(originalPath, newPath);
        req.file.filename = newFilename;
        req.file.path = newPath;

        if (req.file.size > 5 * 1024 * 1024) {
            const compressedPath = newPath.replace(/\.pdf$/i, "_compressed.pdf");
            const success = await compressPDF(newPath, compressedPath);
            if (success) {
                fs.unlinkSync(newPath);
                fs.renameSync(compressedPath, newPath);
                req.file.path = newPath;
            }
        }
        file_pdf = req.file.filename;
    }

    try {
        const finalStatus = "Berlaku"; // <-- status dipaksa "Berlaku"
        await db.promise().execute(
            "INSERT INTO laporan (tahun, bulan, nama, tgl, status, uu, sop, perihal, file_pdf, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [tahun, bulan, nama, tgl, finalStatus, uu, sop, perihal, file_pdf, expiry_date] // <-- pakai finalStatus
        );
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Error insert:", err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint UPDATE dengan PDF
app.post("/api/laporan/update-with-pdf/:id", authenticateToken, upload.single("pdf"), async(req, res) => {
    const id = req.params.id;
    let { nama, tgl, status, uu, sop, perihal, expiry_date } = req.body;
    expiry_date = sanitizeDate(expiry_date);

    try {
        const [oldRows] = await db.promise().execute("SELECT tgl, uu, sop, perihal, file_pdf FROM laporan WHERE id = ?", [id]);
        if (oldRows.length === 0) {
            return res.status(404).json({ error: "Laporan tidak ditemukan" });
        }
        const old = oldRows[0];
        let file_pdf = old.file_pdf;

        const generateNewFilename = (tanggal, div, kep, perihalStr) => {
            const sanitizedUu = sanitizeFilename(div || "uu");
            const sanitizedSop = sanitizeFilename(kep || "sop");
            const sanitizedPerihal = sanitizeFilename(perihalStr || "perihal");
            const timestamp = Date.now();
            return `${tanggal}_DIV${sanitizedUu}_KEP${sanitizedSop}_PER${sanitizedPerihal}_${timestamp}.pdf`;
        };

        const metadataChanged = (tgl && tgl !== old.tgl) || (uu && uu !== old.uu) || (sop && sop !== old.sop) || (perihal && perihal !== old.perihal);

        if (req.file) {
            const newFilename = generateNewFilename(tgl, uu, sop, perihal);
            const newPath = path.join(__dirname, "public/uploads", newFilename);
            fs.renameSync(req.file.path, newPath);
            if (req.file.size > 5 * 1024 * 1024) {
                const compressedPath = newPath.replace(/\.pdf$/i, "_compressed.pdf");
                const success = await compressPDF(newPath, compressedPath);
                if (success) {
                    fs.unlinkSync(newPath);
                    fs.renameSync(compressedPath, newPath);
                }
            }
            if (old.file_pdf) {
                const oldPath = path.join(__dirname, "public/uploads", old.file_pdf);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            file_pdf = newFilename;
        } else if (metadataChanged && old.file_pdf) {
            const oldFilePath = path.join(__dirname, "public/uploads", old.file_pdf);
            if (fs.existsSync(oldFilePath)) {
                const newFilename = generateNewFilename(tgl, uu, sop, perihal);
                const newFilePath = path.join(__dirname, "public/uploads", newFilename);
                fs.renameSync(oldFilePath, newFilePath);
                file_pdf = newFilename;
                console.log(`✅ File PDF direname: ${old.file_pdf} → ${newFilename}`);
            }
        }

        const finalStatus = "Berlaku"; // <-- status dipaksa "Berlaku"
        let query = "UPDATE laporan SET nama = ?, tgl = ?, status = ?, uu = ?, sop = ?, perihal = ?, expiry_date = ?";
        let params = [nama, tgl, finalStatus, uu, sop, perihal, expiry_date]; // <-- pakai finalStatus
        if (file_pdf !== old.file_pdf) {
            query += ", file_pdf = ?";
            params.push(file_pdf);
        }
        query += " WHERE id = ?";
        params.push(id);

        await db.promise().execute(query, params);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Error update:", err);
        res.status(500).json({ error: err.message });
    }
});
// Sisanya (DELETE, GET, dll) tetap sama

// Perbarui endpoint DELETE agar juga menghapus file PDF dari disk
app.delete("/api/laporan/:id", authenticateToken, async(req, res) => {
    try {
        const [rows] = await db.promise().execute("SELECT file_pdf FROM laporan WHERE id = ?", [req.params.id]);
        if (rows.length > 0 && rows[0].file_pdf) {
            const filePath = path.join(__dirname, "public/uploads", rows[0].file_pdf);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await db.promise().execute("DELETE FROM laporan WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.log("ERROR DELETE:", err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint untuk download (otomatis static file sudah bisa diakses via /uploads/namafile)
// Kita juga perlu mengizinkan akses ke folder uploads
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

app.get("/dashboardadmin", authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboardadmin.html"));
});

// Endpoint download manual (mengatasi masalah static serving)
app.get("/api/download-pdf/:filename", authenticateToken, (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, "public/uploads", filename);
    if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'inline; filename="' + filename + '"');
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.status(404).json({ error: "File PDF tidak ditemukan di server" });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});