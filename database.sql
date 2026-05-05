CREATE DATABASE login_app;
USE login_app;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE laporan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tahun VARCHAR(10),
    bulan VARCHAR(20),
    uu VARCHAR(255),
    sop VARCHAR(255),
    perihal VARCHAR(255),
    tgl VARCHAR(20),
    status VARCHAR(10),
    file_pdf VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert user test (password: "password123" di-hash)
INSERT INTO users (username, email, password) VALUES 
('admin', 'admin@example.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');

INSERT INTO users (username, email, password, role) VALUES 
('user1', 'user1@example.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'user');