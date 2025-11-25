import express from "express";
import db from "../config/db.js";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import crypto from "crypto";

const router = express.Router();

const MAIL_USER = "wisemarket28@gmail.com";
const MAIL_PASS = "ffuf jptm tirl qtaj";

// Gmail 발신용 설정 (Gmail + 앱 비밀번호 조합)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: MAIL_USER,
    pass: MAIL_PASS,
  },
});

/**
 * GET /auth/login
 * 로그인 화면
 */
router.get("/login", (req, res) => {
  res.render("auth/login", {
    title: "로그인",
    error: null,
    message: null,
    currentUser: req.session.user || null,
  });
});

/**
 * POST /auth/login
 * 로그인 처리
 * - 이메일/비밀번호 확인
 * - 이메일 인증 여부(is_verified) 확인
 */
router.post("/login", async (req, res) => {
  const { email, password, rememberMe } = req.body;

  if (!email || !password) {
    return res.render("auth/login", {
      title: "로그인",
      error: "이메일과 비밀번호를 모두 입력해 주세요.",
      message: null,
      currentUser: req.session.user || null,
    });
  }

  try {
    const [rows] = await db.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (rows.length === 0) {
      return res.render("auth/login", {
        title: "로그인",
        error: "이메일 또는 비밀번호가 올바르지 않습니다.",
        message: null,
        currentUser: req.session.user || null,
      });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.render("auth/login", {
        title: "로그인",
        error: "이메일 또는 비밀번호가 올바르지 않습니다.",
        message: null,
        currentUser: req.session.user || null,
      });
    }

    // 이메일 인증 체크
    if (!user.is_verified) {
      return res.render("auth/login", {
        title: "로그인",
        error:
          "이메일 인증 후 로그인할 수 있습니다. 학교 이메일로 전송된 인증 메일을 확인해 주세요.",
        message: null,
        currentUser: req.session.user || null,
      });
    }

    // 세션에 로그인 정보 저장
    req.session.user = {
      user_id: user.user_id,
      email: user.email,
      nickname: user.nickname,
      student_id: user.student_id || null,
      department: user.department || null,
    };

    // 로그인 유지 체크
    if (rememberMe) {
      req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7일
    } else {
      req.session.cookie.expires = false; // 브라우저 닫으면 삭제
    }

    res.redirect("/");
  } catch (err) {
    console.error("로그인 오류:", err);
    res.status(500).send("로그인 중 오류가 발생했습니다.");
  }
});

/**
 * GET /auth/signup
 * 회원가입 화면
 */
router.get("/signup", (req, res) => {
  res.render("auth/signup", {
    title: "회원가입",
    error: null,
    message: null,
    currentUser: req.session.user || null,
  });
});

/**
 * POST /auth/signup
 * 회원가입 처리
 * - 동국대 이메일(@dongguk.ac.kr)만 허용
 * - users: email, password, nickname 저장
 * - verify_token 생성 후 이메일로 인증 링크 발송
 */
router.post("/signup", async (req, res) => {
  const { email, password, passwordConfirm, nickname } = req.body;

  let error = "";

  // 기본 검증
  if (!email || !password || !passwordConfirm || !nickname) {
    error = "이메일, 비밀번호, 닉네임은 필수입니다.";
  } else if (!email.includes("@dongguk.ac.kr")) {
    error = "동국대 이메일(@dongguk.ac.kr)만 사용할 수 있습니다.";
  } else if (password !== passwordConfirm) {
    error = "비밀번호와 비밀번호 확인이 일치하지 않습니다.";
  }

  if (error) {
    return res.render("auth/signup", {
      title: "회원가입",
      error,
      message: null,
      currentUser: req.session.user || null,
    });
  }

  try {
    // 이메일 또는 닉네임 중복 체크
    const [dups] = await db.query(
      "SELECT user_id FROM users WHERE email = ? OR nickname = ?",
      [email, nickname]
    );

    if (dups.length > 0) {
      return res.render("auth/signup", {
        title: "회원가입",
        error: "이미 사용 중인 이메일 또는 닉네임입니다.",
        message: null,
        currentUser: req.session.user || null,
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    // 1) 사용자 저장 (is_verified 기본 0, verify_token 나중에 업데이트)
    const [result] = await db.query(
      "INSERT INTO users (email, password, nickname) VALUES (?, ?, ?)",
      [email, hashed, nickname]
    );

    const userId = result.insertId;

    // 2) 이메일 인증용 토큰 생성
    const verifyToken = crypto.randomBytes(32).toString("hex");

    await db.query(
      "UPDATE users SET verify_token = ?, is_verified = 0 WHERE user_id = ?",
      [verifyToken, userId]
    );

    // 3) 인증 메일 발송
    const verifyUrl = `http://49.50.138.73:3000/auth/verify?token=${verifyToken}`;

    try {
      await transporter.sendMail({
        from: `"WISE market" <${MAIL_USER}>`,
        to: email,
        subject: "WISE market 이메일 인증 안내",
        text:
          `WISE market 회원가입을 환영합니다.\n\n` +
          `아래 링크를 클릭하면 이메일 인증이 완료됩니다.\n\n` +
          `${verifyUrl}\n\n` +
          `링크가 눌리지 않으면 주소를 복사해서 브라우저 주소창에 붙여넣어 주세요.`,
      });
    } catch (mailErr) {
      console.error("이메일 전송 오류:", mailErr);
      // 가입은 됐지만 메일 발송 실패
      return res.render("auth/signup", {
        title: "회원가입",
        error: null,
        message:
          "회원가입 정보는 저장되었지만, 인증 메일 전송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        currentUser: req.session.user || null,
      });
    }

    // 4) 정상: 가입 완료 + 메일 발송 완료
    return res.render("auth/signup", {
      title: "회원가입",
      error: null,
      message:
        "회원가입 신청이 완료되었습니다. 학교 이메일로 전송된 인증 메일을 확인해 주세요.",
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error("회원가입 오류:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.render("auth/signup", {
        title: "회원가입",
        error: "이미 사용 중인 이메일 또는 닉네임입니다.",
        message: null,
        currentUser: req.session.user || null,
      });
    }

    res.status(500).send("회원가입 중 오류가 발생했습니다.");
  }
});

/**
 * GET /auth/verify
 * 이메일 인증 처리
 * - ?token=... 으로 들어온 토큰 확인
 */
router.get("/verify", async (req, res) => {
  const token = (req.query.token || "").trim();

  if (!token) {
    return res.status(400).send("잘못된 접근입니다.");
  }

  try {
    const [rows] = await db.query(
      "SELECT * FROM users WHERE verify_token = ?",
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).send("유효하지 않은 인증 요청입니다.");
    }

    const user = rows[0];

    await db.query(
      "UPDATE users SET is_verified = 1, verify_token = NULL WHERE user_id = ?",
      [user.user_id]
    );

    // 이메일 인증 완료 후 로그인 페이지에서 안내 문구 띄우기
    return res.render("auth/login", {
      title: "로그인",
      error: null,
      message: "이메일 인증이 완료되었습니다. 이제 로그인할 수 있습니다.",
      currentUser: null,
    });
  } catch (err) {
    console.error("이메일 인증 처리 오류:", err);
    res.status(500).send("이메일 인증 처리 중 오류가 발생했습니다.");
  }
});

/**
 * POST /auth/logout
 * 로그아웃
 */
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("로그아웃 오류:", err);
    }
    res.redirect("/auth/login");
  });
});


// 이메일 중복 확인 API
router.get("/check-email", async (req, res) => {
  try {
    const { email } = req.query;
    console.log("이메일 중복 확인 요청:", email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "이메일이 전달되지 않았습니다.",
      });
    }

    // users 테이블에서 동일 이메일 갯수 조회
    const [rows] = await db.query(
      "SELECT COUNT(*) AS cnt FROM users WHERE email = ?",
      [email]
    );

    const exists = rows[0].cnt > 0;
    
    const message = exists
      ? "이미 사용 중인 이메일입니다."
      : "사용 가능한 이메일입니다.";

    // ok = true  → 사용 가능
    // ok = false → 이미 존재
    return res.json({
      ok: !exists,
      exists,
      message,
    });
  } catch (err) {
    console.error("이메일 중복 확인 오류(GET):", err);
    return res.status(500).json({
      ok: false,
      message: "서버 오류가 발생했습니다.",
    });
  }
});


export default router;

