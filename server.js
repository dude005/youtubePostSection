const express = require('express');
const session = require('express-session');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const sharp = require('sharp');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

app.use(session({
    secret: 'secret123',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// DB
function loadDB() {
    if (!fs.existsSync('db.json')) return { users: [], posts: [] };
    return JSON.parse(fs.readFileSync('db.json'));
}

function saveDB(db) {
    fs.writeFileSync('db.json', JSON.stringify(db, null, 2));
}

function getImageExtension(dataUrl) {
    const match = dataUrl.match(/^data:image\/(\w+);base64,/);
    return match ? match[1] : 'png';
}

async function saveBase64Image(base64Data, prefix, options = {}) {
    if (!base64Data || !base64Data.startsWith('data:')) return null;
    
    const ext = getImageExtension(base64Data);
    const filename = `${prefix}_${Date.now()}.${ext}`;
    const filepath = './public/uploads/' + filename;
    
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    
    if (options.width || options.height) {
        await sharp(buffer)
            .resize(options.width || null, options.height || null, { fit: 'cover' })
            .toFile(filepath);
    } else {
        fs.writeFileSync(filepath, buffer);
    }
    
    return '/uploads/' + filename;
}

async function saveBase64Media(base64Data, prefix) {
    if (!base64Data || !base64Data.startsWith('data:')) return null;
    
    const isVideo = base64Data.startsWith('data:video');
    const isGif = base64Data.includes('image/gif');
    
    let contentType;
    if (isVideo) {
        contentType = base64Data.match(/^data:video\/(\w+);base64,/);
        contentType = contentType ? contentType[1] : 'mp4';
    } else if (isGif) {
        contentType = 'gif';
    } else {
        contentType = base64Data.match(/^data:image\/(\w+);base64,/);
        contentType = contentType ? contentType[1] : 'png';
    }
    
    const ext = contentType;
    const filename = `${prefix}_${Date.now()}.${ext}`;
    const filepath = './public/uploads/' + filename;
    
    const base64 = base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    
    fs.writeFileSync(filepath, buffer);
    
    return '/uploads/' + filename;
}

async function createCircularPfp(base64Data, prefix) {
    if (!base64Data || !base64Data.startsWith('data:')) return null;
    
    const filename = `${prefix}_${Date.now()}.png`;
    const filepath = './public/uploads/' + filename;
    
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    
    await sharp(buffer)
        .resize(200, 200, { fit: 'cover' })
        .composite([{
            input: Buffer.from('<svg><circle cx="100" cy="100" r="100" fill="white"/></svg>'),
            blend: 'dest-in'
        }])
        .toFile(filepath);
    
    return '/uploads/' + filename;
}

// LOGIN PAGE
app.get('/login', (req, res) => res.render('login'));

// LOGIN
app.post('/login', async (req, res) => {
    const { username, pfpData, bannerData } = req.body;

    const db = loadDB();

    let user = db.users.find(u => u.username === username);
    const pfpPath = pfpData ? await createCircularPfp(pfpData, 'pfp') : null;
    const bannerPath = bannerData ? await saveBase64Image(bannerData, 'banner', { width: 1200, height: 400 }) : null;

    if (!user) {
        user = { username, subs: [], pfp: pfpPath, banner: bannerPath };
        db.users.push(user);
    } else {
        if (pfpPath) user.pfp = pfpPath;
        if (bannerPath) user.banner = bannerPath;
    }

    saveDB(db);
    req.session.user = user;

    res.redirect('/');
});

// HOME
app.get('/', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const db = loadDB();

    const currentUser = db.users.find(u => u.username === req.session.user.username);
    
    const subscriberCount = db.users.filter(u => 
        u.subs && u.subs.includes(req.session.user.username)
    ).length;
    
    const userData = currentUser ? {
        ...req.session.user,
        subs: currentUser.subs || [],
        subsCount: subscriberCount,
        banner: currentUser.banner
    } : req.session.user;

    const sort = req.query.sort || 'newest';
    let posts = [...db.posts];
    if (sort === 'popular') {
        posts.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));
    } else {
        posts.sort((a, b) => b.createdAt - a.createdAt);
    }
    
    res.render('index', {
        user: userData,
        posts: posts,
        formatTime: (ts) => {
            const seconds = Math.floor((Date.now() - ts) / 1000);
            if (seconds < 60) return seconds + 's';
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return minutes + 'm';
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return hours + 'h';
            const days = Math.floor(hours / 24);
            return days + 'd';
        }
    });
});

// CREATE POST
app.post('/create-post', async (req, res) => {
    const db = loadDB();

    let content = req.body.content || req.body.text || '';
    let image = req.body.image || null;
    let video = req.body.video || null;
    let gif = req.body.gif || null;

    let imagePath = null;
    let videoPath = null;
    let gifPath = null;

    if (image && typeof image === 'string' && image.startsWith('data:')) {
        try { imagePath = await saveBase64Media(image, 'image'); } catch(e) { console.error('Image error:', e); }
    }
    if (video && typeof video === 'string' && video.startsWith('data:')) {
        try { videoPath = await saveBase64Media(video, 'video'); } catch(e) { console.error('Video error:', e); }
    }
    if (gif && typeof gif === 'string' && gif.startsWith('data:')) {
        try { gifPath = await saveBase64Media(gif, 'gif'); } catch(e) { console.error('Gif error:', e); }
    }

    const post = {
        id: Date.now().toString(),
        author: req.session.user.username,
        pfp: req.session.user.pfp,
        banner: req.session.user.banner,
        content: content || '',
        image: imagePath,
        video: videoPath,
        gif: gifPath,
        likes: [],
        dislikes: [],
        comments: [],
        createdAt: Date.now()
    };

    db.posts.unshift(post);
    saveDB(db);
    io.emit('postUpdate', db.posts);

    res.json({ success: true });
});

// LIKE
app.post('/like/:id', (req, res) => {
    console.log('Like request for:', req.params.id, 'session:', req.session.user?.username);
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.id);

    if (!post) return res.json({ error: 'Post not found' });

    if (!post.likes.includes(req.session.user.username)) {
        post.likes.push(req.session.user.username);
        post.dislikes = post.dislikes.filter(u => u !== req.session.user.username);
    }

    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// DISLIKE
app.post('/dislike/:id', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.id);

    if (!post) return res.json({ error: 'Post not found' });

    if (!post.dislikes.includes(req.session.user.username)) {
        post.dislikes.push(req.session.user.username);
        post.likes = post.likes.filter(u => u !== req.session.user.username);
    }

    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// COMMENT LIKE
app.post('/like-comment/:postId/:commentId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post?.comments.find(c => c.id === req.params.commentId);
    
    if (!comment) return res.json({ error: 'Comment not found' });
    
    if (!comment.likes) comment.likes = [];
    if (!comment.dislikes) comment.dislikes = [];
    
    const username = req.session.user.username;
    if (!comment.likes.includes(username) && !comment.dislikes.includes(username)) {
        comment.likes.push(username);
    } else if (comment.dislikes.includes(username)) {
        comment.dislikes = comment.dislikes.filter(u => u !== username);
        comment.likes.push(username);
    }

    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// COMMENT DISLIKE
app.post('/dislike-comment/:postId/:commentId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post?.comments.find(c => c.id === req.params.commentId);
    
    if (!comment) return res.json({ error: 'Comment not found' });
    
    if (!comment.likes) comment.likes = [];
    if (!comment.dislikes) comment.dislikes = [];
    
    const username = req.session.user.username;
    if (!comment.dislikes.includes(username) && !comment.likes.includes(username)) {
        comment.dislikes.push(username);
    } else if (comment.likes.includes(username)) {
        comment.likes = comment.likes.filter(u => u !== username);
        comment.dislikes.push(username);
    }

    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// COMMENT (FIXED)
app.post('/comment/:postId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);

    if (!post) return res.send("Post not found");

    const text = req.body.text || req.body.content || '';
    
    post.comments.push({
        id: Date.now().toString(),
        author: req.session.user.username,
        pfp: req.session.user.pfp,
        text: text,
        createdAt: Date.now(),
        editedAt: null,
        likes: [],
        dislikes: [],
        isPinned: false,
        reports: [],
        replies: []
    });

    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// REPLY
app.post('/reply/:postId/:commentId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post?.comments.find(c => c.id === req.params.commentId);
    
    if (!comment) return res.json({ error: 'Comment not found' });
    
    const text = req.body.text || req.body.content || '';

    comment.replies = comment.replies || [];
    comment.replies.push({
        id: Date.now().toString(),
        author: req.session.user.username,
        pfp: req.session.user.pfp,
        text: text,
        createdAt: Date.now(),
        editedAt: null,
        likes: [],
        dislikes: [],
        isPinned: false,
        reports: []
    });

    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// PIN REPLY
app.post('/pin-reply/:postId/:commentId/:replyId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post?.comments.find(c => c.id === req.params.commentId);
    const reply = comment?.replies?.find(r => r.id === req.params.replyId);
    
    if (!reply) return res.json({ error: 'Reply not found' });
    if (post.author !== req.session.user.username) return res.json({ error: 'Only post author can pin' });
    
    reply.isPinned = !reply.isPinned;
    
    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true, isPinned: reply.isPinned });
});

// EDIT REPLY
app.post('/edit-reply/:postId/:commentId/:replyId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post?.comments.find(c => c.id === req.params.commentId);
    const reply = comment?.replies?.find(r => r.id === req.params.replyId);
    
    if (!reply) return res.json({ error: 'Reply not found' });
    if (reply.author !== req.session.user.username) return res.json({ error: 'Only author can edit' });
    
    const newText = req.body.text || req.body.content || '';
    if (!newText.trim()) return res.json({ error: 'Reply cannot be empty' });
    
    reply.text = newText;
    reply.editedAt = Date.now();
    
    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true, text: reply.text, editedAt: reply.editedAt });
});

// REPORT REPLY
app.post('/report-reply/:postId/:commentId/:replyId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post?.comments.find(c => c.id === req.params.commentId);
    const reply = comment?.replies?.find(r => r.id === req.params.replyId);
    
    if (!reply) return res.json({ error: 'Reply not found' });
    
    if (!reply.reports) reply.reports = [];
    const username = req.session.user.username;
    
    if (!reply.reports.includes(username)) {
        reply.reports.push(username);
    }
    
    saveDB(db);
    res.json({ success: true, reportCount: reply.reports.length });
});

// LIKE REPLY
app.post('/like-reply/:postId/:commentId/:replyId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post?.comments.find(c => c.id === req.params.commentId);
    const reply = comment?.replies?.find(r => r.id === req.params.replyId);
    
    if (!reply) return res.json({ error: 'Reply not found' });
    
    if (!reply.likes) reply.likes = [];
    if (!reply.dislikes) reply.dislikes = [];
    
    const username = req.session.user.username;
    if (!reply.likes.includes(username) && !reply.dislikes.includes(username)) {
        reply.likes.push(username);
    } else if (reply.dislikes.includes(username)) {
        reply.dislikes = reply.dislikes.filter(u => u !== username);
        reply.likes.push(username);
    }

    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// DISLIKE REPLY
app.post('/dislike-reply/:postId/:commentId/:replyId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post?.comments.find(c => c.id === req.params.commentId);
    const reply = comment?.replies?.find(r => r.id === req.params.replyId);
    
    if (!reply) return res.json({ error: 'Reply not found' });
    
    if (!reply.likes) reply.likes = [];
    if (!reply.dislikes) reply.dislikes = [];
    
    const username = req.session.user.username;
    if (!reply.dislikes.includes(username) && !reply.likes.includes(username)) {
        reply.dislikes.push(username);
    } else if (reply.likes.includes(username)) {
        reply.likes = reply.likes.filter(u => u !== username);
        reply.dislikes.push(username);
    }

    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// SUBSCRIBE/UNSUBSCRIBE
app.post('/subscribe/:username', (req, res) => {
    const db = loadDB();
    const me = db.users.find(u => u.username === req.session.user.username);
    
    if (!me.subs) me.subs = [];
    
    if (me.subs.includes(req.params.username)) {
        me.subs = me.subs.filter(s => s !== req.params.username);
    } else {
        me.subs.push(req.params.username);
    }

    saveDB(db);
    res.json({ success: true, subs: me.subs });
});

// CHAT - Store messages in memory
let chatMessages = [];
const MAX_CHAT_MESSAGES = 100;

io.on('connection', (socket) => {
    // Send existing chat history
    socket.emit('chatHistory', chatMessages);
    
    socket.on('chat message', (msg) => {
        chatMessages.push(msg);
        if (chatMessages.length > MAX_CHAT_MESSAGES) {
            chatMessages.shift();
        }
        io.emit('chat message', msg);
    });
    
    socket.on('subscribe', (data) => {
        const db = loadDB();
        const user = db.users.find(u => u.username === data.user);
        if (user) {
            socket.broadcast.emit('notification', data.subscriber + ' subscribed to you!');
            const subCount = db.users.filter(u => 
                u.subs && u.subs.includes(data.user)
            ).length;
            io.emit('subUpdate', { username: data.user, count: subCount });
        }
    });
    
    socket.on('unsubscribe', (data) => {
        const db = loadDB();
        const user = db.users.find(u => u.username === data.user);
        if (user && user.subs) {
            user.subs = user.subs.filter(s => s !== data.subscriber);
            saveDB(db);
            const subCount = db.users.filter(u => 
                u.subs && u.subs.includes(data.user)
            ).length;
            io.emit('subUpdate', { username: data.user, count: subCount });
        }
    });
    
    socket.on('getPosts', (data) => {
        const db = loadDB();
        let posts = [...db.posts];
        if (data.sort === 'popular') {
            posts.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));
        } else {
            posts.sort((a, b) => b.createdAt - a.createdAt);
        }
        socket.emit('postUpdate', posts);
    });
});

// LOGOUT - Delete user pfp, banner, and posts
app.get('/logout', (req, res) => {
    const username = req.session.user?.username;
    if (username) {
        const db = loadDB();
        const user = db.users.find(u => u.username === username);
        
        if (user) {
            if (user.pfp && user.pfp.includes('/uploads/')) {
                try { fs.unlinkSync('./public' + user.pfp.replace('/uploads/', '/uploads/')); } catch(e) {}
            }
            if (user.banner && user.banner.includes('/uploads/')) {
                try { fs.unlinkSync('./public' + user.banner.replace('/uploads/', '/uploads/')); } catch(e) {}
            }
            
            db.posts = db.posts.filter(p => p.author !== username);
            
            user.pfp = null;
            user.banner = null;
            
            saveDB(db);
            io.emit('postUpdate', db.posts);
        }
    }
    req.session.destroy();
    res.redirect('/login');
});

// DELETE POST
app.post('/delete-post/:id', (req, res) => {
    const db = loadDB();
    const postIndex = db.posts.findIndex(p => p.id === req.params.id);
    
    if (postIndex !== -1) {
        const post = db.posts[postIndex];
        if (post.author === req.session.user.username) {
            db.posts.splice(postIndex, 1);
            saveDB(db);
            io.emit('postUpdate', db.posts);
        }
    }
    
    res.json({ success: true });
});

// DELETE COMMENT
app.post('/delete-comment/:postId/:commentId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    
    if (post) {
        const commentIndex = post.comments.findIndex(c => c.id === req.params.commentId);
        if (commentIndex !== -1) {
            const comment = post.comments[commentIndex];
            if (comment.author === req.session.user.username) {
                post.comments.splice(commentIndex, 1);
                saveDB(db);
                io.emit('postUpdate', db.posts);
            }
        }
    }
    
    res.json({ success: true });
});

// CUSTOM EMOJIS
app.get('/get-emojis', (req, res) => {
    const db = loadDB();
    if (!db.emojis) db.emojis = [];
    res.json({ emojis: db.emojis });
});

app.post('/upload-emoji', async (req, res) => {
    const { name, data } = req.body;
    if (!data || !data.startsWith('data:')) return res.json({ error: 'Invalid image' });
    
    const ext = data.match(/^data:image\/(\w+);base64,/)?.[1] || 'png';
    const filename = `emoji_${Date.now()}.${ext}`;
    const filepath = './public/emojis/' + filename;
    
    if (!fs.existsSync('./public/emojis')) {
        fs.mkdirSync('./public/emojis', { recursive: true });
    }
    
    const base64 = data.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
    
    const db = loadDB();
    if (!db.emojis) db.emojis = [];
    
    db.emojis.push({
        id: Date.now().toString(),
        name: name,
        url: '/emojis/' + filename,
        uploadedBy: req.session.user?.username || 'anonymous'
    });
    
    saveDB(db);
    res.json({ success: true, emoji: db.emojis[db.emojis.length - 1] });
});

// REACTIONS
app.post('/react/:postId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    if (!post) return res.json({ error: 'Post not found' });
    
    const { emoji } = req.body;
    if (!post.reactions) post.reactions = {};
    if (!post.reactions[emoji]) post.reactions[emoji] = [];
    
    const user = req.session.user.username;
    if (!post.reactions[emoji].includes(user)) {
        post.reactions[emoji].push(user);
    }
    
    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// PIN POST
app.post('/pin/:postId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    if (!post || post.author !== req.session.user.username) return res.json({ error: 'Unauthorized' });
    
    post.pinned = !post.pinned;
    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// FOLLOW/UNFOLLOW USER
app.post('/follow/:username', (req, res) => {
    const db = loadDB();
    const target = db.users.find(u => u.username === req.params.username);
    const me = db.users.find(u => u.username === req.session.user.username);
    
    if (!target || !me) return res.json({ error: 'User not found' });
    
    if (!target.followers) target.followers = [];
    if (!me.following) me.following = [];
    
    if (target.followers.includes(req.session.user.username)) {
        target.followers = target.followers.filter(u => u !== req.session.user.username);
        me.following = me.following.filter(u => u !== req.params.username);
    } else {
        target.followers.push(req.session.user.username);
        me.following.push(req.params.username);
    }
    
    saveDB(db);
    io.emit('postUpdate', db.posts);
    res.json({ success: true });
});

// GET USER PROFILE
app.get('/get-user/:username', (req, res) => {
    const db = loadDB();
    const user = db.users.find(u => u.username === req.params.username);
    if (!user) return res.json({ error: 'User not found' });
    
    const userPosts = db.posts.filter(p => p.author === req.params.username);
    res.json({ user, posts: userPosts });
});

// STORIES
app.post('/create-story', async (req, res) => {
    const db = loadDB();
    if (!db.stories) db.stories = [];
    
    let mediaUrl = null;
    if (req.body.image) {
        mediaUrl = await saveBase64Image(req.body.image, 'story');
    }
    
    db.stories.push({
        id: Date.now().toString(),
        author: req.session.user.username,
        pfp: req.session.user.pfp,
        content: req.body.content,
        image: mediaUrl,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });
    
    db.stories = db.stories.filter(s => s.expiresAt > Date.now());
    saveDB(db);
    io.emit('storiesUpdate', db.stories);
    res.json({ success: true });
});

app.get('/get-stories', (req, res) => {
    const db = loadDB();
    if (!db.stories) db.stories = [];
    res.json({ stories: db.stories.filter(s => s.expiresAt > Date.now()) });
});

server.listen(PORT, () => console.log("Running on " + PORT));