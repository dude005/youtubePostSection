const express = require('express');
const session = require('express-session');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'secret123',
    resave: false,
    saveUninitialized: true
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

function saveBase64Image(base64Data, prefix) {
    if (!base64Data || !base64Data.startsWith('data:')) return null;
    
    const ext = getImageExtension(base64Data);
    const filename = `${prefix}_${Date.now()}.${ext}`;
    const filepath = './public/uploads/' + filename;
    
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
    
    return '/uploads/' + filename;
}

// LOGIN PAGE
app.get('/login', (req, res) => res.render('login'));

// LOGIN
app.post('/login', (req, res) => {
    const { username, pfpData } = req.body;

    const db = loadDB();

    let user = db.users.find(u => u.username === username);
    const pfpPath = saveBase64Image(pfpData, 'pfp');

    if (!user) {
        user = { username, subs: [], pfp: pfpPath };
        db.users.push(user);
    } else if (pfpPath) {
        user.pfp = pfpPath;
    }

    saveDB(db);
    req.session.user = user;

    res.redirect('/');
});

// HOME
app.get('/', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const db = loadDB();

    res.render('index', {
        user: req.session.user,
        posts: db.posts
    });
});

// CREATE POST
app.post('/create-post', (req, res) => {
    const db = loadDB();

    const post = {
        id: Date.now().toString(),
        author: req.session.user.username,
        pfp: req.session.user.pfp,
        content: req.body.content,
        likes: [],
        dislikes: [],
        comments: [],
        createdAt: Date.now()
    };

    db.posts.unshift(post);
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

// COMMENT (FIXED)
app.post('/comment/:postId', (req, res) => {
    const db = loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);

    if (!post) return res.send("Post not found");

    post.comments.push({
        id: Date.now().toString(),
        author: req.session.user.username,
        text: req.body.text,
        createdAt: Date.now(),
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
});

server.listen(PORT, () => console.log("Running on " + PORT));