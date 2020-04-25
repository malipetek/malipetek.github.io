const functions = require('firebase-functions');
const express = require('express');
const { readFile } = require('fs');
const path = require('path');
var device = require('express-device');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');

class CustomResourceLoader extends ResourceLoader {
    fetch(url, options) {
      if (options.element) {
        console.log(`Element ${options.element.localName} is requesting the url ${url}`);
      }
  
      return super.fetch(url, options);
    }
  }

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

app.use(device.capture());
app.use( async (req, res, next) => {
    let rpath = req.path;
    
    if(rpath == '/'){
        rpath = '/index'
    }
    if(req.device_type == 'is_bot') {
        let indexHtml = await file(`/public/prerendered/${rpath}.html`);
        res.send(indexHtml);
    }else{
        next();
    }
});
app.get('*', async (req, res) => {
    let rpath = req.path;
        
    rpath = /blog:/gi.test(rpath) ? '/blog' : rpath;
    
    if(rpath == '/favicon.ico') return res.status(200).send(null);
    
    if(rpath == '/'){
        rpath = '/index'
    }
    let indexHtml = await file('/public/index copy.html');
    
    let view = await file(`public/static/views/${rpath}.template`);

    indexHtml = indexHtml.replace(/{{--view--}}/gi, view);

    const virtualConsole = new VirtualConsole();

    let dom = new JSDOM(indexHtml, { runScripts: "dangerously", virtualConsole, resources: new CustomResourceLoader() });

    virtualConsole.on("error", (err) => { console.error('vdom error :::::::::::::::::::::::', err); });
    res.send(dom.serialize());
});

exports.app = functions.https.onRequest(app);