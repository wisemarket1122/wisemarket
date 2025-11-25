import express from "express";
import db from "../config/db.js";
import multer from "multer";
import path from "path";

const router = express.Router();

/**
 * 커뮤니티 이미지 업로드 설정
 * 실제 위치: public/uploads/community
 * 브라우저 경로: /uploads/community/파일명
 */
const uploadDir = "public/uploads/community";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

const upload = multer({ storage });

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/auth/login");
  }
  next();
}

/**
 * GET /community
 * 게시판 목록
 */
router.get("/", async (req, res) => {
  try {
    const [boards] = await db.query(
      "SELECT * FROM boards ORDER BY board_id ASC"
    );

    res.render("community/index", {
      title: "학교 커뮤니티",
      boards,
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error("게시판 목록 조회 오류:", err);
    res
      .status(500)
      .send("게시판 목록을 불러오는 중 오류가 발생했습니다.");
  }
});

/**
 * GET /community/:boardId
 * 특정 게시판 글 목록 + 검색 + 페이징
 * - 검색: ?q=키워드
 * - 페이지: ?page=숫자 (기본 1)
 * - 한 페이지에 15개
 */
router.get("/:boardId", async (req, res) => {
  const boardId = req.params.boardId;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = 15;
  const offset = (page - 1) * limit;
  const q = (req.query.q || "").trim();

  try {
    const [[board]] = await db.query(
      "SELECT * FROM boards WHERE board_id = ?",
      [boardId]
    );

    if (!board) {
      return res.status(404).send("해당 게시판을 찾을 수 없습니다.");
    }

    let where = "p.board_id = ?";
    const params = [boardId];

    if (q) {
      where += " AND (p.title LIKE ? OR p.content LIKE ?)";
      params.push("%" + q + "%", "%" + q + "%");
    }

    // 게시글 목록
    const [posts] = await db.query(
      `
      SELECT
        p.*,
        u.nickname AS author_nickname
      FROM board_posts p
      JOIN users u ON p.author_id = u.user_id
      WHERE ${where}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    // 전체 개수
    const [countRows] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM board_posts p
      WHERE ${where}
      `,
      params
    );

    const totalPosts = countRows[0].total;
    const totalPages = Math.ceil(totalPosts / limit);

    res.render("community/list", {
      title: board.name,
      board,
      posts,
      q,
      page,
      totalPages,
      totalPosts,
      limit,
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error("게시글 목록 조회 오류:", err);
    res
      .status(500)
      .send("게시글 목록을 불러오는 중 오류가 발생했습니다.");
  }
});

/**
 * GET /community/:boardId/new
 * 글 작성 화면
 */
router.get("/:boardId/new", requireLogin, async (req, res) => {
  const boardId = req.params.boardId;

  try {
    const [[board]] = await db.query(
      "SELECT * FROM boards WHERE board_id = ?",
      [boardId]
    );

    if (!board) {
      return res.status(404).send("해당 게시판을 찾을 수 없습니다.");
    }

    res.render("community/new", {
      title: board.name + " 글쓰기",
      board,
      error: null,
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error("글쓰기 화면 오류:", err);
    res
      .status(500)
      .send("글쓰기 화면을 여는 중 오류가 발생했습니다.");
  }
});

/**
 * POST /community/:boardId/new
 * 글 작성 처리 (이미지 1장 첨부 가능)
 */
router.post(
  "/:boardId/new",
  requireLogin,
  upload.single("image"),
  async (req, res) => {
    const boardId = req.params.boardId;
    const { title, content } = req.body;
    const authorId = req.session.user.user_id;

    if (!title || !content) {
      try {
        const [[board]] = await db.query(
          "SELECT * FROM boards WHERE board_id = ?",
          [boardId]
        );
        return res.render("community/new", {
          title: board ? board.name + " 글쓰기" : "글쓰기",
          board,
          error: "제목과 내용을 모두 입력하세요.",
          currentUser: req.session.user || null,
        });
      } catch (err) {
        console.error("글쓰기 오류:", err);
        return res
          .status(500)
          .send("글을 저장하는 중 오류가 발생했습니다.");
      }
    }

    try {
      let imagePath = null;
      if (req.file) {
        imagePath = "/uploads/community/" + req.file.filename;
      }

      await db.query(
        `
        INSERT INTO board_posts
          (board_id, author_id, title, content, image_path)
        VALUES (?, ?, ?, ?, ?)
        `,
        [boardId, authorId, title, content, imagePath]
      );

      res.redirect("/community/" + boardId);
    } catch (err) {
      console.error("글 저장 오류:", err);
      res.status(500).send("글을 저장하는 중 오류가 발생했습니다.");
    }
  }
);

/**
 * GET /community/:boardId/:postId/edit
 * 게시글 수정 화면
 */
router.get(
  "/:boardId/:postId/edit",
  requireLogin,
  async (req, res) => {
    const boardId = req.params.boardId;
    const postId = req.params.postId;
    const userId = req.session.user.user_id;

    try {
      const [[board]] = await db.query(
        "SELECT * FROM boards WHERE board_id = ?",
        [boardId]
      );
      if (!board) {
        return res
          .status(404)
          .send("해당 게시판을 찾을 수 없습니다.");
      }

      const [[post]] = await db.query(
        `
        SELECT *
        FROM board_posts
        WHERE post_id = ? AND board_id = ? AND author_id = ?
        `,
        [postId, boardId, userId]
      );
      if (!post) {
        return res.status(403).send("수정 권한이 없습니다.");
      }

      res.render("community/edit", {
        title: board.name + " 글 수정",
        board,
        post,
        error: null,
        currentUser: req.session.user || null,
      });
    } catch (err) {
      console.error("게시글 수정 화면 오류:", err);
      res
        .status(500)
        .send("글 수정 화면을 여는 중 오류가 발생했습니다.");
    }
  }
);

/**
 * POST /community/:boardId/:postId/edit
 * 게시글 수정 처리 (이미지 교체 가능)
 */
router.post(
  "/:boardId/:postId/edit",
  requireLogin,
  upload.single("image"),
  async (req, res) => {
    const boardId = req.params.boardId;
    const postId = req.params.postId;
    const userId = req.session.user.user_id;
    const { title, content } = req.body;

    if (!title || !content) {
      try {
        const [[board]] = await db.query(
          "SELECT * FROM boards WHERE board_id = ?",
          [boardId]
        );
        const [[post]] = await db.query(
          `
          SELECT *
          FROM board_posts
          WHERE post_id = ? AND board_id = ? AND author_id = ?
          `,
          [postId, boardId, userId]
        );

        if (!post) {
          return res.status(403).send("수정 권한이 없습니다.");
        }

        return res.render("community/edit", {
          title: board ? board.name + " 글 수정" : "글 수정",
          board,
          post: {
            ...post,
            title,
            content,
          },
          error: "제목과 내용을 모두 입력하세요.",
          currentUser: req.session.user || null,
        });
      } catch (err) {
        console.error("게시글 수정 오류:", err);
        return res
          .status(500)
          .send("글을 수정하는 중 오류가 발생했습니다.");
      }
    }

    try {
      let sql =
        "UPDATE board_posts SET title = ?, content = ?";
      const params = [title, content];

      if (req.file) {
        const imagePath = "/uploads/community/" + req.file.filename;
        sql += ", image_path = ?";
        params.push(imagePath);
      }

      sql +=
        " WHERE post_id = ? AND board_id = ? AND author_id = ?";
      params.push(postId, boardId, userId);

      const [result] = await db.query(sql, params);

      if (result.affectedRows === 0) {
        return res.status(403).send("수정 권한이 없습니다.");
      }

      res.redirect("/community/" + boardId + "/" + postId);
    } catch (err) {
      console.error("게시글 수정 오류:", err);
      res
        .status(500)
        .send("글을 수정하는 중 오류가 발생했습니다.");
    }
  }
);

/**
 * POST /community/:boardId/:postId/delete
 * 게시글 삭제
 */
router.post(
  "/:boardId/:postId/delete",
  requireLogin,
  async (req, res) => {
    const boardId = req.params.boardId;
    const postId = req.params.postId;
    const userId = req.session.user.user_id;

    try {
      const [[post]] = await db.query(
        `
        SELECT *
        FROM board_posts
        WHERE post_id = ? AND board_id = ? AND author_id = ?
        `,
        [postId, boardId, userId]
      );
      if (!post) {
        return res.status(403).send("삭제 권한이 없습니다.");
      }

      await db.query("DELETE FROM comments WHERE post_id = ?", [
        postId,
      ]);

      await db.query(
        `
        DELETE FROM board_posts
        WHERE post_id = ? AND board_id = ? AND author_id = ?
        `,
        [postId, boardId, userId]
      );

      res.redirect("/community/" + boardId);
    } catch (err) {
      console.error("게시글 삭제 오류:", err);
      res
        .status(500)
        .send("게시글을 삭제하는 중 오류가 발생했습니다.");
    }
  }
);

/**
 * GET /community/:boardId/:postId
 * 게시글 상세 + 댓글 목록
 */
router.get("/:boardId/:postId", async (req, res) => {
  const boardId = req.params.boardId;
  const postId = req.params.postId;

  try {
    const [[board]] = await db.query(
      "SELECT * FROM boards WHERE board_id = ?",
      [boardId]
    );
    if (!board) {
      return res.status(404).send("해당 게시판을 찾을 수 없습니다.");
    }

    const [[post]] = await db.query(
      `
      SELECT
        p.*,
        u.nickname AS author_nickname
      FROM board_posts p
      JOIN users u ON p.author_id = u.user_id
      WHERE p.post_id = ? AND p.board_id = ?
      `,
      [postId, boardId]
    );
    if (!post) {
      return res.status(404).send("해당 게시글을 찾을 수 없습니다.");
    }

    const [comments] = await db.query(
      `
      SELECT
        c.*,
        u.nickname AS author_nickname
      FROM comments c
      JOIN users u ON c.author_id = u.user_id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
      `,
      [postId]
    );

    res.render("community/detail", {
      title: post.title,
      board,
      post,
      comments,
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error("게시글 상세 조회 오류:", err);
    res
      .status(500)
      .send("게시글을 불러오는 중 오류가 발생했습니다.");
  }
});

/**
 * POST /community/:boardId/:postId/comments
 * 댓글 작성
 */
router.post(
  "/:boardId/:postId/comments",
  requireLogin,
  async (req, res) => {
    const boardId = req.params.boardId;
    const postId = req.params.postId;
    const { content } = req.body;
    const authorId = req.session.user.user_id;

    if (!content) {
      return res.redirect("/community/" + boardId + "/" + postId);
    }

    try {
      await db.query(
        `
        INSERT INTO comments (post_id, author_id, content)
        VALUES (?, ?, ?)
        `,
        [postId, authorId, content]
      );

      res.redirect("/community/" + boardId + "/" + postId);
    } catch (err) {
      console.error("댓글 저장 오류:", err);
      res
        .status(500)
        .send("댓글을 저장하는 중 오류가 발생했습니다.");
    }
  }
);

/**
 * POST /community/:boardId/:postId/comments/:commentId/delete
 * 댓글 삭제
 */
router.post(
  "/:boardId/:postId/comments/:commentId/delete",
  requireLogin,
  async (req, res) => {
    const boardId = req.params.boardId;
    const postId = req.params.postId;
    const commentId = req.params.commentId;
    const userId = req.session.user.user_id;

    try {
      const [[comment]] = await db.query(
        `
        SELECT c.*
        FROM comments c
        JOIN board_posts p ON c.post_id = p.post_id
        WHERE c.comment_id = ? AND c.post_id = ? AND p.board_id = ?
        `,
        [commentId, postId, boardId]
      );

      if (!comment) {
        return res.status(404).send("댓글을 찾을 수 없습니다.");
      }

      if (comment.author_id !== userId) {
        return res
          .status(403)
          .send("댓글 삭제 권한이 없습니다.");
      }

      await db.query(
        "DELETE FROM comments WHERE comment_id = ?",
        [commentId]
      );

      res.redirect("/community/" + boardId + "/" + postId);
    } catch (err) {
      console.error("댓글 삭제 오류:", err);
      res
        .status(500)
        .send("댓글을 삭제하는 중 오류가 발생했습니다.");
    }
  }
);

export default router;
