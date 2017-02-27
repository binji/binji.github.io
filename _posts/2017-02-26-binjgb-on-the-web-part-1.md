---
layout: post
title:  "binjgb on the web, part 1"
date:   2017-02-26 10:17:00 -0800
---
I've had an emscripten build of my gameboy emulator [binjgb][binjgb] since
September of last year. At first, I just got enough working to render the
display. If you just use emscripten's SDL implementation, it does most of this
for you automatically, but I wanted to write it myself to see how slim I could
make it. Take a look at it running:

<video src="{{ site.url }}/assets/2017-02-26-sml-jank.mp4" autoplay controls>
</video>

This was enough to satisfy me for a while, but I didn't like that it was so
janky. Here's a little snippet of the implementation:

{% highlight javascript %}
function start() {
  ...
  update();
  requestAnimationFrame(render);
}

function update() {
  ...
  _run_emulator_until_event(...);
  ...
  // Synchronize the host with the emulated gameboy.
  if (real_ms < delta_ms) {
    setTimeout(update, delta_ms);
  } else {
    setTimeout(update, 0);
  }
}

function render() {
  ctx.putImageData(imageData, 0, 0);
  requestAnimationFrame(render);
}
{% endhighlight %}

You can see the full commit [here][initial commit].

Using the Chrome devtools, you can see some of the issues causing jankiness:

![initial jank][initial jank]

You can read about the timeline view [here][timeline view]. The important parts
for us here are the red marks ("long frames"). It looks like Chrome calls a
frame "long" if it takes longer than 22ms. Since 60fps is 16.6ms per frame,
this gives considerable leeway before telling you that you screwed up
somewhere.

Skipping down, you can see a frame that took 32.0ms. Not good. In this case,
there isn't much we could have done because the update just took a long time
that frame (27.08ms).

Looking at the frame times after that, there's definitely room for improvement.
We're trying to get as close to 16.6ms as possible. Notice that the frame time
jumps around a lot: 15.8ms, 16.8ms, 20.9ms, 14.3ms, etc.

This happens because the timer is firing to try and synchonize the speed of the
emulator with the speed of a gameboy. The timer callback runs for a while
(typically between 6-8ms). This blocks the requestAnimationFrame callback from
running. It will fire as soon as it can, but this will often be later than we
want for a solid framerate.

The simplest way to fix this is to use requestAnimationFrame the way it is
meant be used: do all the work for updating the frame in the
requestAnimationFrame callback. See the [MDN docs][mdn raf].

I didn't get around to improving this until I added audio earlier this month;
read all about it in the next post!

[binjgb]: https://github.com/binji/binjgb
[initial commit]: https://github.com/binji/binjgb/commit/03192d3f43662c5aa7ba2522e3b46e839b734021
[initial jank]: {{ site.url }}/assets/2017-02-26-initial-jank.png
[timeline view]: https://developers.google.com/web/tools/chrome-devtools/evaluate-performance/timeline-tool
[mdn raf]: http://devdocs.io/dom/window/requestanimationframe
