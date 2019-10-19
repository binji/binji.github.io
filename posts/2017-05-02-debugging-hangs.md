---
tags: post
layout: post
title:  "debugging hangs"
date:   2017-05-03
---

<script type="text/javascript"
    src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.1/MathJax.js?config=TeX-AMS-MML_HTMLorMML">
</script>

# Running pouët Demos

I recently tested some public domain gameboy demos from [pouet.net][] with
binjgb. They're good to run as tests because they're pretty fun, and often do
weirder stuff than a commercial game would do.

One of my favorites is ["Is That a Demo in Your Pocket"][pocket demo] by
snorpung and nordloef. It's goes by pretty quick, but it has a bunch of nice
effects:

![big pockets required][]

As I went down the list of demos on pouet.net, I got to one called
[Man Meets Machine - Alternative Party 2009][jmla09] by jumalauta. I ran
it and got this:

![jmla09 hang][]

**H A N G S !**

# Initial Investigation

OK, so the first thing to determine is where it is hanging. I've recently been
working on a debugger UI using [dear imgui][dear imgui], so I ran the demo in
the debugger and found where it was hanging:

![hang loop][hang loop]

Here's what it's doing:

1. Read from `0xFF44` into the `A` register
1. Increment `A`
1. Copy `A` into the `E` register
1. Read from `0xFF44` into the `A` register
1. Compare `E` to `A`
1. If they are not equal, jump back to step 4.

It seems like this is an infinite loop, right? It keeps reading `0xFF44`
expecting it to change, but never changes it. Well, it turns out that `0xFF44`
is actually the `LY` memory-mapped register. It basically is used to tell the
program what horizontal line is currently being drawn, from 0 to 153. So this
loop is actually just waiting for the next line to start.

# 153?

A bit of an aside about the number 153: the gameboy has a screen resolution
of 160 by 144 pixels. So why 153? Lines 144 to 153 are for the vertical blank
(vblank) period. On a CRT screen, the vertical blank is the time that it takes
the raster gun to go from the bottom-right corner to the top-left corner. The
gameboy has an LCD screen, so it doesn't actually have a vblank, but I guess it
was convenient to pretend that there was one because people expected it.

So why would it hang waiting for the next line? You've probably already
guessed: if the initial read (step 1 above) reads 153, then it will wait for
line 154 which never happens.

Let's take a look at the registers and see if we're right:

![registers][]

The registers are all listed in hexadecimal, so `E` is 0x99, which 153. But
that means that we are waiting for line 153, not line 154. That should be fine,
right?

Well, things are a little more complicated than they seem...

# Digging Deeper

Each line doesn't take the same amount of time. Lines 1 through 152 take 456
cycles. But lines 0 and 153 are special: line 153 only lasts for 4 cycles
before looping back around to line 0 for $$ 456 * 2 - 4 = 908 $$ cycles.

So our loop will only exit if we read from `0xFF44` (step 4) at exactly the
right time, when `LY` is 153 for those 4 cycles.

# Cycle Counting

How likely is this to happen? Let's look at the timing of our loop:

```
0x80b2: f0 44     LD A, (FF44H)
0x80b4: bb        CP E
0x80b5: 20 fb     JR NZ, -5
```

Each instruction on the gameboy CPU takes a multiple of 4 cycles. Each memory
read (including the read of the opcode) takes 4 cycles. Some instructions, like
calls, jumps, and 16-bit operations, take more.

```
LD A, (FF44H)
```

The first instruction takes 12 cycles: 8 to read the instruction (the bytes
`0xf0` and `0x44`) and 4 more to read from the address `0xFF44`.

```
CP E
```

The second instruction takes just 4 cycles.

```
JR NZ, -5
```

The final instruction takes 16 cycles if the branch is taken, 12 if it isn't.

Here is the only scenario where we'll exit the loop. The * marks when we
actually read the `LY` value.

| --- | --- | --- |
| Cycle | Instruction | LY |
| --- | --- | --- |
| N + 0   | LD A, (FF44H) | 152 |
| N + 4   | LD A, (FF44H) | 152 |
| N + 8   | LD A, (FF44H) * | 153 |
| N + 12  | CP E | 0 |
| N + 16  | JR NZ, -5 | 0 |
| N + 20  | JR NZ, -5 | 0 |
| N + 24  | JR NZ, -5 | 0 |
| N + 28  | JR NZ, -5 | 0 |
| --- | --- |

We want to know if this will occur eventually. To find this out we can use the
greatest common divisor. Our loop is $$ 12 + 4 + 16 = 32 $$ cycles, and our
frame takes $$ 456 * 154 = 70224 $$ cycles. The greatest common divisor of
70224 and 32 is 16. This means that LY=153 will only ever occur at two of the
cycle counts above: `N + 0` and `N + 16`, or `N + 4` and `N + 20`, or `N + 8`
and `N + 24` or `N + 12` and `N + 28`.

As we can see from the table above, we want LY=153 to occur at `N + 8`.

I hope this makes sense, I'm having a hard time explaining it. Anyway, the
point is that we only have to loop for two frames before we can know if we'll
ever read 153. Spoiler: we never do.

# Testing on Hardware

Who knows, maybe my emulator got it right? We need to test on real hardware to
know the truth. Fortunately, I bought a cart writer and a couple of writable
cartridges.

<video src="/assets/2017-05-02-hardware-test.mp4" controls></video>

And the truth is: my emulator got it wrong. :disappointed:

# Digging Deeperer

Now that we know the demo should work on hardware, we need to figure out where
the emulator is going wrong. Here are the options:

1. Waiting for line 153 is OK, the bug is that we never read it
1. We shouldn't be waiting for line 153, something screwed up before this

It's hard to know which is right without more info. The debugger has some
features to trace interrupts, I/O reads/writes, etc. Turning those and piping
to a file, we get:

```
 ...
 >> LCD_STAT interrupt [...H]
 >> trigger STAT [LY: 142] [cy: 107863268]
 (0x44 [LY]) = 0x8e
 (0x44 [LY]) = 0x8e
 (0x44 [LY]) = 0x8f
 (0x43 [SCX], 0x1d)
 (0x42 [SCY], 0x83)
 >> LCD_STAT interrupt [...H]
 >> trigger STAT [LY: 143] [cy: 107863724]
 (0x44 [LY]) = 0x8f
 (0x44 [LY]) = 0x8f
 (0x44 [LY]) = 0x90
 (0x43 [SCX], 0x1c)
 (0x42 [SCY], 0x83)
 >> VBLANK interrupt [frame = 1591]
 (0x46 [DMA], 0xce)
 >> LCD_STAT interrupt [...H]
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 0x98
 (0x44 [LY]) = 00
 (0x44 [LY]) = 00
 ...
```

Before we go further, let me briefly explain interrupts. An interrupt is
basically just a signal to the CPU to "interrupt" its normal behavior and do
something different. The gameboy has a few different kinds of interrupts,
generated by the hardware: VBLANK, STAT, TIMER, SERIAL, and JOYPAD. In our
demo, we only care about the VBLANK and STAT interrupts.

The VBLANK interrupt is triggered when a vblank occurs, once every 70224
cycles, which is approximately 16.74ms.

The STAT interrupt can be triggered for a few different reasons, but in this
case, I know that it is for a horizontal blank (hblank) interrupt. Just like
the vertical blank, CRT monitors also have a horizontal blank period where the
raster gun would move from the right side of the screen to the left side, one
line down. The gameboy hblank interrupt is triggered when the current line has
finished drawing. The hblank period doesn't last very long. It's variable, but
it's always less than or equal to 204 cycles.

When an interrupt is triggered, all that really happens is a bit is set in a
memory-mapped I/O register called `IF`. The interrupt isn't handled until the
CPU is ready to do so: for example, an interrupt might be triggered in the
middle of an instruction, but it won't be handled until the instruction is
finished.

The CPU can also disable interrupts via the `DI` instruction. In that case,
the interrupt won't actually be handled until interrupts are enabled again
via the `EI` instruction.

When an interrupt is finally handled, the CPU will branch to a specific
location in memory (address `0x40` for VBLANK, `0x48` for STAT, etc.) and start
executing code there.

# Reading the Log

So coming back to the log above, we have a few different kinds of messages:

* `trigger STAT [LY: 142] [cy: 107863268]`

  This message means the graphics hardware has triggered a STAT interrupt at
  line 142. `cy` is the current cycle count.

* `LCD_STAT interrupt [...H]`

  This particular message means we've started executing the hblank interrupt
  handler (`H` is for hblank).
  
* `VBLANK interrupt [frame = 1591]`

  This message means we've started executing the vblank interrupt handler, and
  this is the 1591st frame rendered.

* `(0x44 [LY]) = 0x8f`

  This message means the we read the `LY` register and got the value `0x8f`.

This output shows exactly when everything goes wrong. Notice at the end that we
read `0x98` (152) from `LY`, then wrap around to reading 0. But what happens
before that? Something strange happens right here:

```
 >> VBLANK interrupt [frame = 1591]
 (0x46 [DMA], 0xce)
 >> LCD_STAT interrupt [...H]
```

The hblank interrupt only fires for lines 0 through 143. After that, we're in
the vblank period and no hblanks interrupts should occur. So why do we see the
hblank interrupt handler executing *after* the vblank interrupt handler?

# Handling Multiple Interrupts

Notice that the hblank interrupt is triggered before the vblank interrupt, but
it isn't handled until after. We can see something else strange looking at
where the hblank interrupt is triggered:

```
 >> LCD_STAT interrupt [...H]
 >> trigger STAT [LY: 143] [cy: 107863724]
```

Normally an interrupt is triggered, then is handled. But this is backward --
the interrupt is being handled before it is triggered!

When an interrupt is handled, interrupts are disabled automatically, just as if
you executed the `DI` instruction. If any other interrupts are triggered at
this point, they won't be handled until the current interrupt handler
re-enables interrupts.

So here's what actually is happening: for some reason, the hblank interrupt is
being triggered while we're already handling the previous hblank interrupt.
This also explains why the last hblank interrupt occurs after the vblank
interrupt: it's the hblank interrupt for line 143!

# Where Does It Go Wrong?

This answers some of our questions, but asks some new ones. Why is the hblank
interrupt firing while we're already handling the previous one? If we look back
in the logs we find this:

```
 >> trigger STAT [LY: 128] [cy: 107856884]
 >> LCD_STAT interrupt [...H]
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 >> trigger STAT [LY: 129] [cy: 107857340]
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x81
 (0x44 [LY]) = 0x82
 (0x43 [SCX], 0x1e)
 (0x42 [SCY], 0x7f)
 >> LCD_STAT interrupt [...H]
 >> trigger STAT [LY: 130] [cy: 107857796]
```

Aha! This is where we flip from trigger=\>handle to handle=\>trigger. In
between, we see that we must be in the same loop reading `LY` waiting for 82.
But this one takes much longer than it normally does. Usually the loop only
takes 1 or 2 reads before it gets to the next line (aside from when it
hangs...)

To figure out why this happens, we need a bit more information. Here's the real
log output from the emulator:

```
 107856424: :>> trigger STAT [LY: 127] [cy: 107856428]
 107856428: :>> LCD_STAT interrupt [...H]
 107856608: :(0x44 [LY]) = 0x7f
 107856628: :(0x44 [LY]) = 0x80
 ...
 107856880: :>> trigger STAT [LY: 128] [cy: 107856884]
 107856904: :>> LCD_STAT interrupt [...H]
 107857084: :(0x44 [LY]) = 0x81
 107857104: :(0x44 [LY]) = 0x81
 107857132: :(0x44 [LY]) = 0x81
 ...
```

The number on the right is the current cycle count. The first hblank interrupt
in this example is handled very quickly, $$ 107856428 - 107856424 = 4 $$ cycles
after the interrupt is triggered.

The second hblank interrupt is handled $$ 107856904 - 107856880 = 24 $$ cycles
after it was triggered. Those extra 20 cycles mean that we miss the end of the
previous line. Remember that our loop takes 32 cycles, so missing by 20 cycles
is quite a lot.

OK, so now we know why the hblank interrupt is firing after the hblank
interrupt, and we know why the hblank interrupt is triggered after the previous
hblank interrupt is handled. But why does the interrupt handler take 4 cycles
some times and 24 cycles others? It all depends on what instruction is being
executed when the interrupt is triggered. As we learned above, some
instructions are fast (like `CP E` above, 4 cycles) and some instructions are
slow (like `CALL`, 24 cycles). The interrupt is only handled when the
instruction has finished, so a long running instruction can delay the interrupt
being handled.

While writing this, I had an interesting thought: what if I make the interrupt
handler check for interrupts earlier than that? That is, what if we do
something like this:

1. Read initial byte of opcode
1. If there are pending interrupts:
    1. Stop executing that instruction
    1. Jump to the interrupt handler and start executing the new instruction
1. Else:
    1. Execute the rest of the instruction

This is basically the same as triggering all interrupts 4 cycles earlier.
Interestingly, when I run this:

![jmla09 works][]

**W O R K S !**

But it is the right fix? Well... that's the tricky part. It fixes this hang,
and some other tests, but breaks some other tests. It also doesn't match the
specified interrupt behavior of a Z80 CPU (the gameboy CPU is not a Z80, but is
pretty close).

# Epilogue

I started writing this blog post last week, expecting to start and finish it in
a couple of days. Since I discovered this fix, I've been trying to figure out
how to keep it working, and all the other tests, so I could have a really
awesome finish to this blog post! But no such luck. I guess this is a more
accurate ending, instead -- things are a little better here, a little worse
there; the never-ending struggle of accuracy-driven emulator development.

[pouet.net]: https://www.pouet.net
[big pockets required]: /assets/2017-05-02-big-pockets-required.gif
[pocket demo]: https://www.pouet.net/prod.php?which=65997
[jmla09]: https://www.pouet.net/prod.php?which=53578
[jmla09 hang]: /assets/2017-05-02-jmla09-hang.gif
[jmla09 works]: /assets/2017-05-02-jmla09-works.gif
[dear imgui]: https://github.com/ocornut/imgui
[hang loop]: /assets/2017-05-02-hang-loop.png
[registers]: /assets/2017-05-02-registers.png
