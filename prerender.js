const prerender = require('prerender');
const path = require('path');
const fs = require('fs-extra');
const { parseString } = require('xml2js');
const request = require('request-promise');

const server = prerender({ port: 3222});
server.start();
parseString(fs.readFileSync('./functions/public/static/sitemap.xml', 'UTF-8'), function(err, res) {
    Promise.all(res.urlset.url.map(url => url.loc[0]).map(async url => {
        var html = await request({ url: 'http://localhost:3222/render?url=' + url })

        console.log('ph', url, url.replace, typeof url);
        let path = url.replace(/(.+)(\/)([^\/]*$)/, '$3')
        path = path == '' ? 'index' : path;
        console.log('ph', `./functions/public/prerendered/${path}.html`);
        fs.outputFileSync(`./functions/public/prerendered/${path}.html`, html);
        return 0;
    })).then(res => console.log('done'));
})

