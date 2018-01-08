---
layout: post
title:  "binjgb on the web, part 2"
date:   2017-02-27 19:57:00 -0800
---

This is part 2 of a series on [binjgb][binjgb], see [part 1][part 1]!

# WebAssembly

![webassembly][webassembly img]

For the past few years I've been contributing to the [WebAssembly][webassembly]
project. I primarily have been working on [wabt][wabt], a suite of tools for
working with WebAssembly files. It's been a lot of fun, and I've learned a lot
too. _And_ there's a lot I could write about WebAssembly, and I probably will
at some point. But for now, the only reason I brought it up is because it leads
to...

# FullStackFest

Last year, I was invited to give a talk at [FullStackFest][fullstackfest] about
WebAssembly, titled "WebAssembly: birth of a virtual ISA". The talk is
basically an overview of WebAssembly, followed by a deep dive where I take C++,
convert it to the WebAssembly text format, then convert that to the WebAssembly
binary format, then finally convert it to x86 assembly, all in 30 minutes!

<iframe width="560" height="315" src="https://www.youtube.com/embed/vmzz17JGPHI" frameborder="0" allowfullscreen></iframe>

I wanted a nice WebAssembly demo for the talk. There's the
[AngryBots demo][angrybots] on the WebAssembly homepage, which is pretty cool,
but I wanted something that was more _me_. I had started working on binjgb
earlier that year, so it seemed like an obvious choice. It's not very flashy,
and sure, there are tons of Gameboy emulators around, but I was proud of my
little creation and I wanted to show it off!

Since the talk was about WebAssembly, I needed to get a WebAssembly version
building, so I started hacking away on it during the week of the conference.
Without too much effort, I ended up with the code you saw in part 1. Since my
slides were made using reveal.js, I was easily able to embed the running
emulator into my slides as an iframe:

![binjgb slides][binjgb slides]

Probably should have spent some time centering the iframe... oh, well. I really
wanted to get audio working, so you could hear that
[dee-da-da-dum, bee--bum][sml music], but I just didn't have the time. I
actually didn't even get it working until earlier this month.

# WebAudio

I'd never used WebAudio before, and it's a bit tricky to know exactly how
you're supposed to use it. If you are just trying to play a wav or mp3, it's
pretty easy and straightforward. But what if you're trying to programatically
generate audio?

Most sources point to the [ScriptProcessorNode][scriptprocessornode] for this.

Here's the basic idea:

{% highlight javascript %}
// Create your audio context.
var ctx = new AudioContext();

// Create a node w/ buffer size 4096 and one output channel.
var node = new ScriptProcessorNode(4096, 0, 1);

node.onaudioprocess = function(event) {
  var buffer = event.outputBuffer;
  var channel = buffer.getChannelData(0);
  for (var i = 0; i < 4096; ++i) {
    // Write samples, f32 in range [-1, 1].
    channel[i] = ...;
  }
}

// Wire the node up to the AudioContext sink.
node.connect(ctx.destination);
{% endhighlight %}

This _does_ work. But it has a couple problems. First it's callback based. That
would be fine if the callback could interrupt your running code. But it can't,
so if you're hogging the main JavaScript thread, then your audio buffer isn't
being filled.

The next problem is that it is deprecated, and has been since August 29th,
2014, if MDN is to be believed.

# Better than ScriptProcessorNode

MDN says that ScriptProcessorNode is deprecated. OK, so what do we use instead?

> ... and is soon to be replaced by Audio Workers.

OK, sounds good. So how do you use Audio Workers?

> Audio workers ... are not implemented in any browsers yet.

`(-_-)`

So I went to see what Emscripten does. Rather than having the audio engine
pull samples via a callback, they push buffers down and tell the engine to
play them at a specific time. Something like this:

{% highlight javascript %}
var buffer = ctx.createBuffer(channels, samples, sampleRate);
var channel = buffer.getChannelData(0);
for (var i = 0; i < 4096; ++i) {
  channel[i] = ...;
}

var bufferSource = ctx.createBufferSource();
bufferSource.buffer = buffer;
bufferSource.connect(ctx.destination);
bufferSource.start(playTime);
{% endhighlight %}

This works surprisingly well! Since we're pushing the data down, we can do it
at any time, including during our `requestAnimationFrame` callback. We don't
have to worry about yielding control of the main thread to allow an audio
callback to fire.

To get gapless playback, you just need to make sure that you have the next
buffer queued up before the current buffer finishes playing. You can determine
how long this buffer will play by calculating `samples / sampleRate`. So the
next buffer should start playing at `playTime + samples / sampleRate`.

The audio engine has a builtin timer (accessed via `ctx.currentTime`) that you
can use to schedule the playback. The first buffer should start playing a
little after the current time. The further out you push it, the more time you
have to queue up the subsequent buffers.

Speaking of which, here are a few issues that you may run into when
implementing audio playback...

# Audio Caveats

If you're playing audio and you drop a buffer (i.e. you don't queue up a buffer
quickly enough for the audio engine), you'll immediately hear it as a pop,
click or crackle. It sounds horrible.

<video src="{{ site.url }}/assets/2017-02-27-tetris-audio-crackle.mp4" controls>
</video>

The only way to resolve this is to introduce latency -- increase the buffer
size or push out the time between now and when the next buffer plays.
Increasing the latency means you're less likely to starve the audio engine, but
also means that the audio and input will be desynchronized: you press the jump
button and hear the jump half a second later.

<video src="{{ site.url }}/assets/2017-02-27-sml-audio-latency.mp4" controls>
</video>

# Implementing WebAudio in binjgb

I finally had a pretty decent implementation using the above strategy in
binjgb. You can take a look at the commit [here][binjgb audio]. One interesting
aspect is that binjgb generates a 2-channel, interleaved 8-bit audio stream.
Since WebAudio requires a 32-bit float audio stream, with indpendent channels,
we have to move things around a bit:

{% highlight javascript %}
var channel0 = buffer.getChannelData(0);
var channel1 = buffer.getChannelData(1);
var outPos = 0;
var inPos = 0;
for (var i = 0; i < inSamples; i++) {
  channel0[outPos] = (audioBuffer[inPos] - 128) / 128;
  channel1[outPos] = (audioBuffer[inPos+1] - 128) / 128;
  outPos++;
  inPos += 2;
}
{% endhighlight %}

This audio implementation is still pretty much what I have now. There's still
more to talk about, though. In my next post, we'll dive into WebGL!

In the meantime, I'll leave you with this, some of my favorite videogame music:

<video src="{{ site.url }}/assets/2017-02-27-megaman3-music.mp4" controls>
</video>

[binjgb]: https://github.com/binji/binjgb
[part 1]: {{ site.baseurl }}{% post_url 2017-02-26-binjgb-on-the-web-part-1 %}
[webassembly img]: {{ site.url }}/assets/webassembly.png
[wabt]: https://github.com/WebAssembly/wabt
[webassembly]: http://webassembly.org/
[fullstackfest]: https://2016.fullstackfest.com/
[fullstackfest talk]: https://www.youtube.com/watch?v=vmzz17JGPHI
[angrybots]: http://webassembly.org/demo/
[binjgb slides]: {{ site.url }}/assets/2017-02-27-fsf-demo.jpg
[sml music]: https://www.youtube.com/watch?v=Gb33Qnbw520
[scriptprocessornode]: https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode
[binjgb audio]: https://github.com/binji/binjgb/commit/ac7c7887
