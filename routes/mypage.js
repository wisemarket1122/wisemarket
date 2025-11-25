import express from "express";
import db from "../config/db.js";
import bcrypt from "bcrypt";

const router = express.Router();

// 로그인 필수
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/auth/login");
  }
  next();
}

// 마이페이지 메인
router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;

  try {
    // 내 정보
    const [[user]] = await db.query(
      "SELECT * FROM users WHERE user_id = ?",
      [userId]
    );

// 내 정보 수정 화면

// 내 정보 수정 화면
router.get("/edit", requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;

  try {
    const [[user]] = await db.query(
      "SELECT * FROM users WHERE user_id = ?",
      [userId]
    );

    if (!user) {
      return res.status(404).send("사용자 정보를 찾을 수 없습니다.");
    }

    res.render("mypage/edit", {
      title: "내 정보 수정",
      userInfo: user,
      error: "",
      message: "",
      currentUser: req.session.user,
    });
  } catch (err) {
    console.error("내 정보 수정 페이지 오류:", err);
    res
      .status(500)
      .send("내 정보 수정 페이지를 불러오는 중 오류가 발생했습니다.");
  }
});


    // 내가 올린 장터 글
    const [marketItems] = await db.query(
      `SELECT *
       FROM market_items
       WHERE seller_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    // 내가 쓴 커뮤니티 글
    const [posts] = await db.query(
      `SELECT p.*, b.name AS board_name
       FROM board_posts p
       JOIN boards b ON p.board_id = b.board_id
       WHERE p.author_id = ?
       ORDER BY p.created_at DESC`,
      [userId]
    );

    res.render("mypage/index", {
      title: "마이페이지",
      userInfo: user,
      marketItems,
      posts,
      currentUser: req.session.user,
    });
  } catch (err) {
    console.error("마이페이지 로드 오류:", err);
    res.status(500).send("마이페이지를 불러오는 중 오류가 발생했습니다.");
  }
});

// 내 정보 수정 처리
router.post("/edit", requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const { nickname, currentPassword, newPassword, newPasswordConfirm } = req.body;

  let error = "";
  let message = "";

  if (!nickname || !nickname.trim()) {
    error = "닉네임을 입력해 주세요.";
  }

  try {
    // 현재 유저 정보
    const [[user]] = await db.query(
      "SELECT * FROM users WHERE user_id = ?",
      [userId]
    );

    if (!user) {
      return res.status(404).send("사용자 정보를 찾을 수 없습니다.");
    }

    // 닉네임 중복 체크 (본인 제외)
    if (!error) {
      const [dups] = await db.query(
        "SELECT user_id FROM users WHERE nickname = ? AND user_id <> ?",
        [nickname, userId]
      );

      if (dups.length > 0) {
        error = "이미 사용 중인 닉네임입니다.";
      }
    }

    // 비밀번호 변경할지 여부 결정
    let updateSql = "UPDATE users SET nickname = ?";
    const params = [nickname];

    const hasPasswordInput =
      currentPassword || newPassword || newPasswordConfirm;

    if (!error && hasPasswordInput) {
      // 하나라도 쓴 경우 → 세 칸 모두 필수
      if (!currentPassword || !newPassword || !newPasswordConfirm) {
        error =
          "비밀번호를 변경하려면 현재 비밀번호, 새 비밀번호, 새 비밀번호 확인을 모두 입력해 주세요.";
      } else if (newPassword !== newPasswordConfirm) {
        error = "새 비밀번호와 비밀번호 확인이 일치하지 않습니다.";
      } else {
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) {
          error = "현재 비밀번호가 일치하지 않습니다.";
        } else {
          const hashed = await bcrypt.hash(newPassword, 10);
          updateSql += ", password = ?";
          params.push(hashed);
        }
      }
    }

    if (!error) {
      updateSql += " WHERE user_id = ?";
      params.push(userId);

      await db.query(updateSql, params);

      // 세션에 있는 닉네임도 같이 업데이트
      if (req.session.user) {
        req.session.user.nickname = nickname;
      }

      message = "내 정보가 수정되었습니다.";
    }
  } catch (err) {
    console.error("내 정보 수정 처리 오류:", err);
    if (!error) {
      error = "내 정보 수정 중 오류가 발생했습니다.";
    }
  }

  // 수정 후 다시 내 정보 수정 화면으로 렌더링
  try {
    const [[user]] = await db.query(
      "SELECT user_id, email, nickname FROM users WHERE user_id = ?",
      [userId]
    );

    res.render("mypage/edit", {
      title: "내 정보 수정",
      userInfo: user,
      error,
      message,
      currentUser: req.session.user,
    });
  } catch (err) {
    console.error("내 정보 수정 페이지 재로딩 오류:", err);
    res
      .status(500)
      .send("내 정보 수정 페이지를 불러오는 중 오류가 발생했습니다.");
  }
});


// 회원탈퇴 처리

router.post("/delete-account", requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;

  try {
    // 1) 내가 쓴 댓글 삭제
    await db.query(
      "DELETE FROM comments WHERE author_id = ?",
      [userId]
    );

    // 2) 내가 쓴 게시글에 달린 댓글 삭제 + 게시글 삭제
    const [postRows] = await db.query(
      "SELECT post_id FROM board_posts WHERE author_id = ?",
      [userId]
    );
    const postIds = postRows.map((row) => row.post_id);

    if (postIds.length > 0) {
      // 내 게시글에 달린 댓글 삭제
      await db.query(
        "DELETE FROM comments WHERE post_id IN (?)",
        [postIds]
      );

// 내 정보 수정 처리
router.post("/edit", requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const { nickname, currentPassword, newPassword, newPasswordConfirm } = req.body;

  let error = "";
  let message = "";

  if (!nickname || !nickname.trim()) {
    error = "닉네임을 입력해 주세요.";
  }

  try {
    // 현재 유저 정보
    const [[user]] = await db.query(
      "SELECT * FROM users WHERE user_id = ?",
      [userId]
    );

    if (!user) {
      return res.status(404).send("사용자 정보를 찾을 수 없습니다.");
    }

    // 닉네임 중복 체크 (본인 제외)
    if (!error) {
      const [dups] = await db.query(
        "SELECT user_id FROM users WHERE nickname = ? AND user_id <> ?",
        [nickname, userId]
      );

      if (dups.length > 0) {
        error = "이미 사용 중인 닉네임입니다.";
      }
    }

    // 비밀번호 변경할지 여부 결정
    let updateSql = "UPDATE users SET nickname = ?";
    const params = [nickname];

    const hasPasswordInput =
      currentPassword || newPassword || newPasswordConfirm;

    if (!error && hasPasswordInput) {
      // 하나라도 쓴 경우 → 세 칸 모두 필수
      if (!currentPassword || !newPassword || !newPasswordConfirm) {
        error =
          "비밀번호를 변경하려면 현재 비밀번호, 새 비밀번호, 새 비밀번호 확인을 모두 입력해 주세요.";
      } else if (newPassword !== newPasswordConfirm) {
        error = "새 비밀번호와 비밀번호 확인이 일치하지 않습니다.";
      } else {
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) {
          error = "현재 비밀번호가 일치하지 않습니다.";
        } else {
          const hashed = await bcrypt.hash(newPassword, 10);
          updateSql += ", password = ?";
          params.push(hashed);
        }
      }
    }

    if (!error) {
      updateSql += " WHERE user_id = ?";
      params.push(userId);

      await db.query(updateSql, params);

      // 세션에 있는 닉네임도 같이 업데이트
      if (req.session.user) {
        req.session.user.nickname = nickname;
      }

      message = "내 정보가 수정되었습니다.";
    }
  } catch (err) {
    console.error("내 정보 수정 처리 오류:", err);
    if (!error) {
      error = "내 정보 수정 중 오류가 발생했습니다.";
    }
  }

  // 수정 후 다시 내 정보 수정 화면으로 렌더링
  try {
    const [[user]] = await db.query(
      "SELECT user_id, email, nickname FROM users WHERE user_id = ?",
      [userId]
    );

    res.render("mypage/edit", {
      title: "내 정보 수정",
      userInfo: user,
      error,
      message,
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error("내 정보 수정 페이지 재로딩 오류:", err);
    res
      .status(500)
      .send("내 정보 수정 페이지를 불러오는 중 오류가 발생했습니다.");
  }
});

      // 내 게시글 삭제
      await db.query(
        "DELETE FROM board_posts WHERE post_id IN (?)",
        [postIds]
      );
    } else {
      // 혹시 모를 경우를 위해 author_id 기준으로 한 번 더 정리
      await db.query(
        "DELETE FROM board_posts WHERE author_id = ?",
        [userId]
      );
    }

    // 3) 내가 참여한 채팅방/메시지 삭제
    const [roomRows] = await db.query(
      "SELECT room_id FROM chat_rooms WHERE buyer_id = ? OR seller_id = ?",
      [userId, userId]
    );
    const roomIds = roomRows.map((row) => row.room_id);

    if (roomIds.length > 0) {
      // 채팅 메시지 삭제
      await db.query(
        "DELETE FROM chat_messages WHERE room_id IN (?)",
        [roomIds]
      );

      // 채팅방 삭제
      await db.query(
        "DELETE FROM chat_rooms WHERE room_id IN (?)",
        [roomIds]
      );
    }

    // 4) 내가 올린 장터 상품 삭제
    await db.query(
      "DELETE FROM market_items WHERE seller_id = ?",
      [userId]
    );

    // 5) 마지막으로 유저 계정 삭제
    await db.query(
      "DELETE FROM users WHERE user_id = ?",
      [userId]
    );

    // 6) 세션 종료 후 홈으로 이동
    req.session.destroy((err) => {
      if (err) {
        console.error("세션 삭제 오류:", err);
      }
      res.redirect("/");
    });
  } catch (err) {
    console.error("회원탈퇴 처리 오류:", err);
    res.status(500).send("회원탈퇴 처리 중 오류가 발생했습니다.");
  }
});

export default router;
