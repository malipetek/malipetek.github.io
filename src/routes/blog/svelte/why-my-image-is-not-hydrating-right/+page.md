# Why my image is not hydrating correctly when Svelte initializes

## Preface
I am writing a Shopify theme using [liquivelte](https://liquivelte.js.org) which is in essence liquid rendered html being hydrated with svelte.

I have added support for the [image_tag filter](https://shopify.dev/docs/api/liquid/filters/image_tag) which outputs a `img` tag so it is not a input output case for svelte side. Normally how I handle liquid filter conterpart on svelte side is like this. Let's say there is a image_url filter 
```liquivelte
<img src="{{- somevalue | image_url: width: 300 -}}" >
```
liquivelte converts it to 
```svelte
<img src="{ liquid.image_url(somevalue, {width: 300}) }">
```

This is fine for input output case scenarios. However `image_tag` is different. One might say this is a more complex filter. Then I moved forward with adding an exception for `image_tag` and it became like this.
Lets say we have a image tag expression:
```liquivelte
<div class="image-container">
  {{- product.images[0] | image_url: width: 300 | image_tag }}
</div>
```
It would output 
```svelte
<div class="image-container">
  <img {...liquid.image_tag( liquid.image_url(product.images[0], {width: 300}), {} ) } />
</div>
```

I thought why not, lets add `image_tag` filter as a utility function and spread props that come out of it. I did not see what was coming.

## The Problem
I realized images are loading correctly, however there was a flashing. Images would reload. This is a no no, this means large layout shifts, this means bad UX. But what was wrong, I checked network panel for single image and it was loading exactly same image 2 times. Here is I am comparing 2 urls thinking it got to be different.
![image url comparison](/link-comparison.jpg)

I went to svelte issues and spent some time on this [better hydration issue](https://github.com/sveltejs/svelte/issues/4308) but I was thinking "this is about iframes and stuff, images are so essential for web it would be much more fuss it this was happening on images all the time". Then I went back to trustworthy devtools to find my way around. Started debugging and added a `debugger;` statement at the end of image statement as an inline script. That would stop html parsing at that point so I know at that point initial image is there. At this point I went to "elements" panel and added (DOM breakpoints)[https://developer.chrome.com/docs/devtools/javascript/breakpoints/#dom] to the element itself to find out which function is replacing or modifying the element.
![ss of adding dom breakpoints](/debugger.jpg)

Indeed I found the function who replaces the node and adds a new one. It is a core svelte function called `claim_element_base`.
![function with name claim_element_base](/attributes.jpg) 

This function is checking if existing element has attributes of the svelte counterpart of that element. If it does not have an attribute it mark it for removal. 

This is what gpt has to say about it:
![gpts word on the function](/gpt_exp.jpg)

## Conclusion
At the end of the day answer to question of this article is; if you use props spreading in svelte, your elements will get destroyed and re-created when hydrating. I now converted the conversion logic to use attributes one by one and it works like a charm.

When there is a expression in liquid side with image tag I convert it to 
```svelte
<div>
  <img src="{liquid.image_url(product.images[0], {width: 300}), {} ) }" srcset="..." alt="..." />
</div>
```

instead of prop spreading like this:
```svelte
<div class="image-container">
  <img {...liquid.image_tag( liquid.image_url(product.images[0], {width: 300}), {} ) } />
</div>
```

## Outro
I am not someone with obsession to address layout shift issues. Layout shifts are unacceptable in todays more and more competitive web development industry. They are the one of best known UX spoilers and we should eliminate them at whichever cost I believe.

Doing so it more and more easy nowadays. With the death of IE and browser vendors adopting improvements faster than ever, you should at least ship code with [`aspect-ratio` css property](https://developer.mozilla.org/en-US/docs/Web/CSS/aspect-ratio) to ensure thing do not jump around when page is loading or styles are applying consecutively.

### Related Topics
If you care I would suggest learning these concepts for a performance competitive or UX acceptable web page.
- [Critical CSS (above the fold styles)](https://web.dev/extract-critical-css/)
- [Apect-ratio](https://caniuse.com/mdn-css_properties_aspect-ratio)
- [Object-fit](https://caniuse.com/object-fit)
- [Lazy loading images](https://web.dev/native-lazy-loading/)
- [Using responsive images (srcset)](https://developer.mozilla.org/en-US/docs/Learn/HTML/Multimedia_and_embedding/Responsive_images)
- [Minification and compression of assets](https://developer.mozilla.org/en-US/docs/Learn/Performance/How_fast#minification_and_compression_of_assets)
- [Module preloading](https://developer.chrome.com/blog/modulepreload/)
- [Optimizing third-party scripts](https://web.dev/optimize-third-party-javascript/)
- [Code splitting](https://webpack.js.org/guides/code-splitting/)
- [Preloading in general](https://www.smashingmagazine.com/2016/02/preload-what-is-it-good-for/)
- [Prefetching url(when using client side routing)](https://css-tricks.com/prerender-on-hover/)