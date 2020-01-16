const functions = require('firebase-functions');
const express = require('express');
const { readFile } = require('fs');
const path = require('path');
// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

const app = express();

app.use('/static', express.static('public/static'));

function file(_path){
    return new Promise(done => {
        readFile(path.join(__dirname, _path), 'utf8', (err, data) => {
            if (err) {
                throw err;
            } else {
                done(data);
            }
        });
    });
}
app.get('*', async (req, res) => {
    let rpath = req.path;
    console.log(rpath);
    if(rpath == '/favicon.ico') return res.status(200).send(null);
    if(rpath == '/'){
        rpath = '/index'
    }
    let indexHtml = await file('/public/index.html');
    
    let view = await file(`public/static/views/${rpath}.template`);

    indexHtml = indexHtml.replace(/{{--view--}}/gi, view);
    res.send(indexHtml);
});

exports.app = functions.https.onRequest(app);