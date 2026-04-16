# MyTube - Feature History

## v1.1 (Latest - Commit: 96bc1eb)
**Date:** 2026-04-16
**Status:** STABLE

### Features:
- Fully realtime - all actions update without page reload
- Livestream-style chat (persists, stored in server memory)
- Subscribe/Unsubscribe toggle button
- Sub count shows YOUR subscribers (personalized)
- Chat history persists when page reloads
- Nested replies on comments (click Reply to reply)
- Comment likes/dislikes with counts
- Delete comments
- Complete mobile responsive design (360px - 768px+)
- Clean modern UI with Roboto font

### Fixes:
- Chat messages no longer disappear on post
- Sub count shows correctly for each user
- All realtime socket updates working

---

## v1.0 (Commit: c3325db)
**Date:** 2026-04-15
**Status:** STABLE - First Working Version

### Features:
- Login with username + profile picture
- Profile picture circular cropping (200x200 via Sharp)
- Banner upload (1200x400)
- Create posts with text, images, videos, GIFs
- Banner displayed at top of posts
- Like/Dislike posts with count display
- Comment on posts
- Like/Dislike comments
- Reply to comments
- Subscribe to channels
- Subscriber count badge (red) in navbar
- Real-time notifications
- Chat room (Socket.io)
- Sort posts by Newest or Popular
- Delete own posts
- Logout functionality
- Session persists 24 hours

---

## v0.1 (Commit: c35e1b9)
**Date:** 2026-04-15
**Status:** BETA

### Features:
- Session persistence added
- Logout button
- Delete posts
- Comment likes/dislikes

---

## Tech Stack
- Node.js + Express
- EJS Templates
- Socket.io (Real-time)
- Sharp (Image processing)
- In-memory JSON database