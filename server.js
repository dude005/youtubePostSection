const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'yt-secret',
    resave: false,
    saveUninitialized: true
}));

const dbFile = path.join(__dirname, 'db.json');

function loadDB() {
    if(!fs.existsSync(dbFile)) return { users: [], posts: [] };
    return JSON.parse(fs.readFileSync(dbFile));
}

function saveDB(db) {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

// ---- ROUTES ----

// LOGIN
app.get('/login', (req,res) => res.render('login'));
app.post('/login', (req,res) => {
    const { username, pfpData, bannerData } = req.body;
    if(!username) return res.sendStatus(400);

    const db = loadDB();
    let pfpPath = null, bannerPath = null;
    if(pfpData){
        const file = `pfp_${Date.now()}.png`;
        fs.writeFileSync(path.join(__dirname,'public','uploads',file), pfpData.split(',')[1],'base64');
        pfpPath = '/uploads/' + file;
    }
    if(bannerData){
        const file = `banner_${Date.now()}.png`;
        fs.writeFileSync(path.join(__dirname,'public','uploads',file), bannerData.split(',')[1],'base64');
        bannerPath = '/uploads/' + file;
    }

    db.users.push({username, pfp:pfpPath, banner:bannerPath});
    saveDB(db);

    req.session.username = username;
    req.session.pfp = pfpPath;
    req.session.banner = bannerPath;

    res.sendStatus(200);
});

// HOME
app.get('/', (req,res)=>{
    if(!req.session.username) return res.redirect('/login');
    const db = loadDB();
    res.render('index', { user: req.session, posts: db.posts });
});

// CREATE POST
app.post('/create-post',(req,res)=>{
    const db = loadDB();
    const { content, option1, option2, bannerImage } = req.body;

    const newPost = {
        id: Date.now().toString(),
        author: req.session.username,
        pfp: req.session.pfp,
        banner: bannerImage || req.session.banner,
        content,
        comments: [],
        likes: [],
        dislikes: [],
        createdAt: Date.now()
    };

    if(option1 && option2){
        newPost.poll = {
            options: { [option1]: {}, [option2]: {} },
            votes: { [option1]: [], [option2]: [] },
            totalVotes: 0
        };
    }

    db.posts.unshift(newPost);
    saveDB(db);
    res.redirect('/');
});

// LIKE / DISLIKE POST
app.post('/like-post/:id', (req,res)=>{
    const db = loadDB();
    const post = db.posts.find(p=>p.id===req.params.id);
    if(!post) return res.redirect('/');
    if(!post.likes.includes(req.session.username)) {
        post.likes.push(req.session.username);
        post.dislikes = post.dislikes.filter(u=>u!==req.session.username);
    }
    saveDB(db);
    res.redirect('/');
});

app.post('/dislike-post/:id', (req,res)=>{
    const db = loadDB();
    const post = db.posts.find(p=>p.id===req.params.id);
    if(!post) return res.redirect('/');
    if(!post.dislikes.includes(req.session.username)) {
        post.dislikes.push(req.session.username);
        post.likes = post.likes.filter(u=>u!==req.session.username);
    }
    saveDB(db);
    res.redirect('/');
});

// COMMENTS
app.post('/comment/:postId', (req,res)=>{
    const db = loadDB();
    const post = db.posts.find(p=>p.id===req.params.postId);
    if(!post) return res.redirect('/');
    const comment = {
        id: Date.now().toString(),
        author: req.session.username,
        pfp: req.session.pfp,
        text: req.body.text,
        likes: [],
        dislikes: [],
        createdAt: Date.now(),
        replies: []
    };
    post.comments.push(comment);
    saveDB(db);
    res.redirect('/');
});

// LIKE / DISLIKE COMMENT
app.post('/like-comment/:postId/:commentId', (req,res)=>{
    const db = loadDB();
    const post = db.posts.find(p=>p.id===req.params.postId);
    if(!post) return res.redirect('/');
    const comment = post.comments.find(c=>c.id===req.params.commentId);
    if(!comment) return res.redirect('/');
    if(!comment.likes.includes(req.session.username)) {
        comment.likes.push(req.session.username);
        comment.dislikes = comment.dislikes.filter(u=>u!==req.session.username);
    }
    saveDB(db);
    res.redirect('/');
});

app.post('/dislike-comment/:postId/:commentId', (req,res)=>{
    const db = loadDB();
    const post = db.posts.find(p=>p.id===req.params.postId);
    if(!post) return res.redirect('/');
    const comment = post.comments.find(c=>c.id===req.params.commentId);
    if(!comment) return res.redirect('/');
    if(!comment.dislikes.includes(req.session.username)) {
        comment.dislikes.push(req.session.username);
        comment.likes = comment.likes.filter(u=>u!==req.session.username);
    }
    saveDB(db);
    res.redirect('/');
});

// REPLIES
app.post('/reply/:postId/:commentId', (req,res)=>{
    const db = loadDB();
    const post = db.posts.find(p=>p.id===req.params.postId);
    if(!post) return res.redirect('/');
    const comment = post.comments.find(c=>c.id===req.params.commentId);
    if(!comment) return res.redirect('/');
    const reply = {
        id: Date.now().toString(),
        author: req.session.username,
        pfp: req.session.pfp,
        text: req.body.text,
        likes: [],
        dislikes: [],
        createdAt: Date.now(),
        replies: []
    };
    comment.replies.push(reply);
    saveDB(db);
    res.redirect('/');
});

// POLL VOTE
app.post('/poll/:postId', (req,res)=>{
    const db = loadDB();
    const post = db.posts.find(p=>p.id===req.params.postId);
    if(!post || !post.poll) return res.redirect('/');
    const option = req.body.option;
    if(!post.poll.votes[option]) post.poll.votes[option]=[];
    if(!post.poll.votes[option].includes(req.session.username)) {
        post.poll.votes[option].push(req.session.username);
        post.poll.totalVotes = Object.values(post.poll.votes).reduce((a,b)=>a+b.length,0);
    }
    saveDB(db);
    res.redirect('/');
});

app.listen(3000,()=>console.log("Server running on http://localhost:3000"));