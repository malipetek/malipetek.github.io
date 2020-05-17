const express = require('express');
const fetch = require('node-fetch');
const { toXML } = require('jstoxml');
var format = require('xml-formatter');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');
var os = require("os");

(async () => {
    const sitemap = await fs.readJSON(path.join(__dirname, 'sitemap.json'));

    class Page {
        constructor() {
            this.page;

            return this;
    }
    async asyn() {
        const browser = await puppeteer.launch({
            headless: !!1
        });

        this.page = await browser.newPage();
        return this;
    }
    async getHtml() {
        return await this.page.content();
    }
    async close() {
        
        await browser.close();
        return this;
    }
    async open(path) {
       
        await this.page.goto('https://malipetek.github.io/');
        await this.page.evaluate(path => {
            sessionStorage.redirect = `https://malipetek.github.io/${path}`;
        }, path);
        await this.page.waitFor(5000);
        return this;
    }
    async getLinks() {
        const view = await this.page.$('#view');
        const links = await view.$$eval('a', nodes => nodes.map(node => node.href));
        return links;
    }
}

    const blogsPage = await new Page().asyn();

    await blogsPage.open('blog');
    const links = await blogsPage.getLinks();
    
    await Promise.all(links.map(async path_ => {
        const page = await new Page().asyn();
        await page.open(path_);

        blog = sitemap._content.find(entry => entry.url.loc.indexOf('https://malipetek.github.io/blog') !== -1 );
        blog._content = (blog._content || []).concat([{
            "url": {
                "loc": `https://malipetek.github.io/blog/${path_}`,
                "lastmod": new Date().toISOString(),
                "priority": .7
            }
        }])
        const html = await page.getHtml();
        await fs.outputFile(path.join(__dirname, path_) + '.html', html, {}, () => {});
        return 1;
    }))
    //new Page().open('blog:CSS-only-toggleables');
    await fs.outputFile(path.join(__dirname, 'sitemap.xml'), format(toXML(sitemap)) + os.EOL);
})();
