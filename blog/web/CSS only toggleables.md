---
title: Old trick to use state on web pages without any js

description: 

summary: 
keywords: 

image: 
---
# Toggle something on a Web page without JS

If you are gaining experience in CSS and trying the limits of CSS, this trick will make you think CSS more powerful than ever before. Some years ago I learned this trick from [Travis Neilson](http://travisneilson.com/) in this [video](https://www.youtube.com/watch?v=d4P8s-mkMvs).

We all know how you can use transitions and hover to change state of a element to create some interactivity. What if I told you you can make it toggle instead of temporarily changing state.

## Labels and inputs

To understand this trick, first thing you should know is `<input>` tags are binded to their labels with `id` and `for` properties.

Lets say you have a text input with `id="mytext"`, when you click on a `<label>` with `for="mytext"` it behaves just like you clicked `<input>`.

## Checkbox

So in our case we will be using a `<input>` with `type="checkbox` to toggle stuff. And toggler will be a `<label>` with `for="[id of input]"`.

## :checked state

In css we have a pseudo selector `:checked`. It applies some styles only when a `<input type="checkbox">` is checked. This allows us to apply some styles with permanent states not only to `<input>` itself, but also its siblings and children.

However `<input>` tags cant have any children. Here we use these CSS selectors to enhance our selection; `~`.

## ~ Selector

[~ Selector](https://www.w3schools.com/cssref/sel_gen_sibling.asp) is a selector that looks back in a siblings situation and checks if a selector has another selector before it among its siblings.

For example if we had a html like this: 
```html
    <div>
    <div class="key">key</div>
    <div></div>
    <div></div>
    <div class="lock">lock</div>
  </div>
   <div>
    <div></div>
    <div></div>
    <div></div>
    <div class="lock">lock</div>
  </div>
```

We could select only first `<div>` with class "lock" with this selector.
```css
.key~.lock{
  color: red;
}
```
See example here:
<iframe height="332" style="width: 100%;" scrolling="no" title="CSS ~ selector example" src="https://codepen.io/malipetek/embed/xxwrOow?height=332&theme-id=dark&default-tab=css,result" frameborder="no" allowtransparency="true" allowfullscreen="true" loading="lazy">
  See the Pen <a href='https://codepen.io/malipetek/pen/xxwrOow'>CSS ~ selector example</a> by muhammet ali petek
  (<a href='https://codepen.io/malipetek'>@malipetek</a>) on <a href='https://codepen.io'>CodePen</a>.
</iframe>

---

Once we select a element after some sibling, we can also select children of selection which is handy because we can make this our main wrapper on page and toggle any styles on our page with this stateful selector.

Here is an example on Codepen demonstrating it:
<iframe height="455" style="width: 100%;" scrolling="no" title="CSS toggle stuff" src="https://codepen.io/malipetek/embed/mdemGPX?height=455&theme-id=dark&default-tab=result" frameborder="no" allowtransparency="true" allowfullscreen="true" loading="lazy">
  See the Pen <a href='https://codepen.io/malipetek/pen/mdemGPX'>CSS toggle stuff</a> by muhammet ali petek
  (<a href='https://codepen.io/malipetek'>@malipetek</a>) on <a href='https://codepen.io'>CodePen</a>.
</iframe>


Also you can go wild it like in below example:

<iframe height="429" style="width: 100%;" scrolling="no" title="CSS only desktop" src="https://codepen.io/malipetek/embed/PoPJNWx?height=429&theme-id=dark&default-tab=result" frameborder="no" allowtransparency="true" allowfullscreen="true" loading="lazy">
  See the Pen <a href='https://codepen.io/malipetek/pen/PoPJNWx'>CSS only desktop</a> by muhammet ali petek
  (<a href='https://codepen.io/malipetek'>@malipetek</a>) on <a href='https://codepen.io'>CodePen</a>.
</iframe>

If you check above examples code you will see it has a html soup. 

You probably would use this trick only for navigation sidebars, modals etc.
