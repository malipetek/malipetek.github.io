const express = require('express');
const fetch = require('node-fetch');

const puppeteer = require('puppeteer');

const app = express();

app.get('/', async (req, res) => {
    let response, status;
    try{    
        let html;   
        await (async () => {
            const browser = await puppeteer.launch();
            const page = await browser.newPage();
            await page.evaluateOnNewDocument(async () => {
               await page.addScriptTag({
                    content: `sessionStorage.redirect = 'https://malipetek.github.io/blog:CSS-only-toggleables';`
                });
            });

            await page.goto('https://malipetek.github.io/');

            html = await page.content();
            console.log(html);
            await browser.close();
        })();

        status = 200;
        response = html;
    } catch (err) {
        status = 500;
        console.log(err);
        response = JSON.stringify(err);
    } finally {
        return res.status(status).send(response);
    }
});

app.listen(3003);