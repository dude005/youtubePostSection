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
    if (!base64Data || !base64Data.startsWith('data:image') && !base64Data.startsWith('data:video')) return null;
    
    const isVideo = base64Data.startsWith('data:video');
    const ext = isVideo ? 'mp4' : getImageExtension(base64Data);
    const filename = `${prefix}_${Date.now()}.${ext}`;
    const filepath = './public/uploads/' + filename;
    
    let base64;
    if (isVideo) {
        base64 = base64Data.replace(/^data:video\/\w+;base64,/, '');
    } else {
        base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    }
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
    const userData = currentUser ? {
        ...req.session.user,
        subs: currentUser.subs || [],
        banner: currentUser.banner
    } : req.session.user;

    res.render('index', {
        user: userData,
        posts: db.posts,
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

    const { content, image, video, gif } = req.body;

    let imagePath = null;
    let videoPath = null;
    let gifPath = null;

    if (image) imagePath = await saveBase64Media(image, 'image');
    if (video) videoPath = await saveBase64Media(video, 'video');
    if (gif) gifPath = await saveBase64Media(gif, 'gif');

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
    
    io.emit('newPost', post);
    saveDB(db);

    res.redirect('/');
});

// LIKE
app.post('/like/:id', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.id);

    if (!post.likes.includes(req.session.user.username)) {
        post.likes.push(req.session.user.username);
        post.dislikes = post.dislikes.filter(u => u !== req.session.user.username);
    }

    saveDB(db);
    res.redirect('/');
});

// DISLIKE
app.post('/dislike/:id', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.id);

    if (!post.dislikes.includes(req.session.user.username)) {
        post.dislikes.push(req.session.user.username);
        post.likes = post.likes.filter(u => u !== req.session.user.username);
    }

    saveDB(db);
    res.redirect('/');
});

// COMMENT LIKE
app.post('/like-comment/:postId/:commentId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post.comments.find(c => c.id === req.params.commentId);
    
    if (!comment) return res.send("Comment not found");
    
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
    res.redirect('/');
});

// COMMENT DISLIKE
app.post('/dislike-comment/:postId/:commentId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    const comment = post.comments.find(c => c.id === req.params.commentId);
    
    if (!comment) return res.send("Comment not found");
    
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
    res.redirect('/');
});

// COMMENT (FIXED)
app.post('/comment/:postId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);

    if (!post) return res.send("Post not found");

    post.comments.push({
        id: Date.now().toString(),
        author: req.session.user.username,
        pfp: req.session.user.pfp,
        text: req.body.text,
        createdAt: Date.now(),
        likes: [],
        dislikes: [],
        replies: []
    });

    saveDB(db);
    res.redirect('/');
});

// REPLY
app.post('/reply/:postId/:commentId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);

    const comment = post.comments.find(c => c.id === req.params.commentId);

    comment.replies.push({
        author: req.session.user.username,
        text: req.body.text,
        createdAt: Date.now()
    });

    saveDB(db);
    res.redirect('/');
});

// SUBSCRIBE
app.post('/subscribe/:username', (req, res) => {
    const db = loadDB();

    const me = db.users.find(u => u.username === req.session.user.username);

    if (!me.subs.includes(req.params.username)) {
        me.subs.push(req.params.username);
    }

    saveDB(db);
    res.redirect('/');
});

// CHAT
io.on('connection', (socket) => {
    socket.on('chat message', (msg) => {
        io.emit('chat message', msg);
    });
    
    socket.on('like', (data) => {
        socket.broadcast.emit('like', data);
    });
    
    socket.on('dislike', (data) => {
        socket.broadcast.emit('dislike', data);
    });
    
    socket.on('comment', (data) => {
        io.emit('comment', data);
    });
    
    socket.on('subscribe', (data) => {
        const db = loadDB();
        const user = db.users.find(u => u.username === data.user);
        if (user) {
            socket.broadcast.emit('newSubscriber', { user: data.user, subscriber: data.subscriber });
        }
    });
});

// LOGOUT
app.get('/logout', (req, res) => {
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
        }
    }
    
    res.redirect('/');
});

server.listen(PORT, () => console.log("Running on " + PORT));