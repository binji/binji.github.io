---
tags: post
layout: post
title: "raw wasm: making a maze race, part 2"
date: 2020-10-27
---

<script type="text/javascript"
    src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.6/MathJax.js?config=TeX-AMS-MML_SVG">
</script>

This post is part of a series. Read [part 1][] first before reading this one!

## Step 5: Texturing the floor and ceiling

When we finished last time, we were rendering four textured walls, with a solid
color for the ceiling and floor:

<div class="wasm-demo">
  <div class="iframe-wrapper">
    <iframe width="400" height="300" src="/assets/2019-10-20-textured.html"></iframe>
    <div class="info" style="max-width: 400px;">
      Use the arrow keys to move, or tap on the left or right side of the screen to turn. <span class="size">1173 bytes</span>.
    </div>
    <a href="https://github.com/binji/binji.github.io/blob/master/assets/2019-10-20-textured.html">(HTML source)</a>
    <a href="https://gist.github.com/binji/3c32bf59856487b59a6620756c96ec7a">(.wat source)</a>
  </div>
</div>

This is what Wolfenstein 3D did, but we can do better nowadays! The trick is to
realize that unlike a wall, which has a constant distance for each vertical
strip, the ceiling has a constant distance for each horizontal strip.

So we can create a nice texturing effect by using a distance table with an
entry for each y value on the screen. The closer the y-coordinate gets to the
center of the screen vertically, the further away the ceiling and floor must
be.

This demo shows how that distance table can be used. Lighter shades of gray are
used when the ceiling and floor are closer, and darker shades when they are
further away. 

<div class="wasm-demo">
  <div class="iframe-wrapper">
    <iframe width="400" height="300" src="/assets/2019-10-27-gradient.html"></iframe>
    <div class="info" style="max-width: 400px;">
      Use the arrow keys to move, or tap on the left or right side of the screen to turn.
    </div>
  </div>
</div>

We're using the following equation to calculate the half-height
(\\(\mbox{hh}\\)) of a wall in pixels, where \\(t_1\\) is the distance along
the ray to the intersection, and \\(120\\) is half of the screen height:

$$ \mbox{hh} = \left\lfloor \frac{120}{t_1} \right\rfloor $$

A wall is always drawn in the center of the screen.
So for any given vertical strip, the pixels filled are:

$$
\begin{array}{lcl}
\mbox{ceiling} &=& [0,120-\mbox{hh}) \\\\
\mbox{wall} &=& [120-\mbox{hh},120+\mbox{hh}) \\\\
\mbox{floor} &=& [120+\mbox{hh},240) \\\\
\end{array}
$$

This means that a wall that is 3 units away in world-space would be drawn with
a half-height of 40 pixels. This also means that the ceiling at \\(y = 120 - 40
= 80\\) is also 3 units away, since the ceiling starts at the same distance as
the top of the wall.

So we can calculate the distance of a given ceiling y-coordinate with the
equation:

$$ k = \frac{120}{120 - y} $$

We can create a table at the beginning of the program by using a [start
function][], which runs during WebAssembly instantation, before any exports can
be called. Creating a table saves us from having to do a divide per pixel:

```wasm
(start $init)
(func $init
  (local $y i32)
  (loop $loop
    ;; mem[0xe00 + ($y << 2)] = 120.0 / (120 - $y);
    (f32.store offset=0xe00
      (i32.shl (local.get $y) (i32.const 2))
      (f32.div
        (f32.const 120)
        (f32.sub (f32.const 120) (f32.convert_i32_s (local.get $y)))))

    (br_if $loop
      (i32.lt_s
        (local.tee $y (i32.add (local.get $y) (i32.const 1)))
        (i32.const 120)))))
```

We can use this distance value when we're drawing the ceiling and floor to get
the uv coordinate to lookup into their textures. Since we store it from 0
through 120, top to bottom, we can start reading from the distance table in
order, and increment it once every time through the loop.

Since we draw the mirror floor pixel at the same time as the ceiling pixel, we
can use the same distance value for both.

```wasm
(local $dist-addr i32)
(local $dist f32)

;; Loop over all pixels in the ceiling and floor.
(loop $loop
  (local.set $dist (f32.load offset=0xe00 (local.get $dist-addr)))
  (local.set $dist-addr (i32.add (local.get $dist-addr) (i32.const 4)))

  ...

  (br_if $loop
    (local.tee $y (i32.sub (local.get $y) (i32.const 1)))))))
```

Now we need to figure out the uv coordinate of the pixel, given the distance.
Fortunately, that's not too hard! If we pretend that the wall has 0 height in
world-space (i.e. all rays are fired in a 2D plane), then the world position of
the intersection of the ray with the ceiling is:

$$ \textbf{c} = \textbf{o} + k\textbf{d} $$

Where \\(\textbf{o}\\) is the ray origin, and \\(\textbf{d}\\) is the direction
of the ray. In other words, it's \\(k\\) units in the direction of
the ray, starting at the player's position.

![ray][]

We can write this in wasm:

```wasm
;; find UV using distance table
(local.set $u
  (f32.add (global.get $Ox) (f32.mul (local.get $dx) (local.get $dist))))
(local.set $v
  (f32.add (global.get $Oy) (f32.mul (local.get $dy) (local.get $dist))))
```

Now we can use this uv coordinate in our existing `$texture` function! But I
want to use a different texture for the floor and ceiling:

<img src="/assets/2019-10-27-ceiling.png" width="256" height="256" style="image-rendering: pixelated;">

We can converting this to 2 bits per pixel (bpp) the same way as last time, but
we need to modify the `$texture` function to allow different textures and
palettes first:

The `$tex-addr` and `$pal-addr` are added in right before doing the memory
load.

```wasm
(func $texture
      (param $tex-addr i32) (param $pal-addr i32)
      (param $u f32) (param $v f32)
      (result i32)

  ;; Read palette entry.
  (i32.load
    (i32.add
      (local.get $pal-addr)
      ...
        ;; Read texture pixel.
        (i32.load8_u
          (i32.add
            (local.get $tex-addr)
            ...
            ))
      ))
```

Now we can update where we draw the ceiling and floor pixels to do a texture
lookup instead:

```wasm
;; draw ceiling
(i32.store offset=0x3000  ;; RGBA pixel address
  (local.get $addr)
  (call $texture
    (i32.const 0x500)  ;; texture address
    (i32.const 0xd10)  ;; palette address
    (local.get $u) (local.get $v)))

...

;; draw floor
(i32.store offset=0x3000
  (local.get $bot-addr)
  (call $texture
    (i32.const 0x500)  ;; texture address
    (i32.const 0xd1c)  ;; palette address
    (local.get $u) (local.get $v)))
```

We can use the same texture with a different palette for the ceiling to make it
a bit more visually interesting, for only 16 bytes!

Ceiling palette:

<img src="/assets/2019-10-27-ceiling-palette.png" width="192" height="64" style="image-rendering: pixelated;">

Floor palette:

<img src="/assets/2019-10-27-floor-palette.png" width="192" height="64" style="image-rendering: pixelated;">

```wasm
(data (i32.const 0xd00)
  ;; brick palette
  "\f3\5f\5f\ff\79\0e\0e\ff\00\00\00\ff\9f\25\25\ff"
  ;; ceiling palette
  "\62\8d\c6\ff\81\95\af\ff\62\8d\c6\ff"
  ;; floor palette
  "\81\95\af\ff\b5\b5\b5\ff\62\8d\c6\ff"
)
```

Let's see it in action:

<div class="wasm-demo">
  <div class="iframe-wrapper">
    <iframe width="400" height="300" src="/assets/2019-10-27-ceiling-and-floor.html"></iframe>
    <div class="info" style="max-width: 400px;">
      Use the arrow keys to move, or tap on the left or right side of the screen to turn. <span class="size">1555 bytes</span>.
    </div>
    <a href="https://github.com/binji/binji.github.io/blob/master/assets/2019-10-27-ceiling-and-floor.html">(HTML source)</a>
    <a href="https://gist.github.com/binji/53ee5326803242d3b8bda0840f6f9b57">(.wat source)</a>
  </div>
</div>

## Step 6: Making a maze

It's pretty fun to run around already, but this is supposed to be a maze race,
not a big square room race. I started to think the demo looked kind of like the
Windows 98 maze screensaver, just without a maze.

At this point, I thought I might try to recreate the look of that screensaver,
so I tried looking for some info about it. I found a great twitter thread by
[Foone Turing][foone] discussing the maze generation algorithm the screensaver
used (as well as a lot of other interesting stuff):

<div class="twitter">
<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Three fun facts about the Windows 9x &quot;3D Maze&quot; screen saver:<br>1. The source to it is in the NT 4.0 SDK<br>2. You can set the number of rats. It&#39;s normally at 1, but it can go as high as 10. <br>3. It&#39;s biased towards lefties. <a href="https://t.co/QlAbhXwH8T">pic.twitter.com/QlAbhXwH8T</a></p>&mdash; foone (@Foone) <a href="https://twitter.com/Foone/status/1018649977608798208?ref_src=twsrc%5Etfw">July 16, 2018</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
</div>

In particular:

> I also did some research on how it generates the maze. It uses Kruskal's
> algorithm. At the start, the maze is full of walls, and consists of 144
> separate sets. It randomly selects a wall, and if each side of the wall is in
> a separate set, it deletes the wall and merges the sets

> this repeats until there's only one set left. Now every cell in the maze is
> connected to every other cell in the maze by one unique path.

Foone also mentions that this algorithm can be found in [Jamis Buck][jamis]'s
book, [Mazes for Programmers][maze book]. But it's also in a [blog post][maze
blog] by Jamis too! This is a really great blog post, with nice pictures,
interactive demos, and Ruby code implementing the algorithm. Give it a read!

To implement the algorithm, we need to decide how big the maze is. I chose a 12
by 12 maze, since that was what the Windows 98 screensaver did. This means that
there are 144 cells in the grid. At the start of the algorithm no cells are
connected, so there are also 144 distinct cell sets.

We start with every possible wall in the grid filled in. The boundaries of the
maze are always included, so the algorithm only needs to consider the interior
walls. For an \\(n\\) by \\(m\\) maze, we start with \\(m(n - 1)\\) vertical
walls and \\(n(m - 1)\\) horizontal walls. For a 12 by 12 maze, that gives 264
initial walls.

Every step, we choose a wall whose two sides are not already in the same cell
set and remove that wall. This means that after every step we have reduced the
number of cell sets by 1. Since we start with \\(nm\\) cell sets and we end
when there is a single cell set, the algorithm must run for \\(nm - 1\\) steps.
We know we have \\(m(n - 1) + n(m - 1) = 2nm - m - n\\) initial walls and we
remove a wall every step, the final number of walls is always:

$$
(2nm - m - n) - (nm - 1) \\\\
nm - m - n + 1 \\\\
(n - 1)(m - 1)
$$

or in our case, 121 walls.

Now that we know the maximum number of cells and walls, we can start to do the
data design for the algorithm. Each grid cell needs to store a number which
identifies which cell set it belongs to. Since there are a maximum of 144 cell
sets, we can use a byte to represent this number, which we'll call a cell set
ID.

The WebAssembly text format doesn't let you allocate memory or even name memory
addresses, so I just keep a little comment near the top of the file laying out
where everything is. So here's the layout for this 12 by 12 cell set grid. For
now, I use 256 bytes of space, even though I only need 144.

```wasm
;; [0x0000, 0x0100)   u8[12*12]       maze cells for Kruskal's algo
```

Next we need an array of walls. Each wall is defined by which two grid cells it
connects. Each grid cell can be given a number from 0 to 143, counting from the
upper-left corner, moving right across columns, then down over rows. For
example, cell 0 is the upper-left corner, cell 11 is the upper-right corner,
and cell 143 is the lower-right corner of the grid. So each wall contains two
cell IDs (not to be confused with the cell set IDs).

Each wall is either horizontal or vertical. Vertical walls divide two adjacent
cells in the same row, which means their cell IDs always differ by 1.
Horizontal walls divide two adjacent cells in the same column, so their cell
IDs always differ by 12. Therefore we don't actually need to store the
direction of the wall in our wall "struct", since we can always recover this
information from the two cell IDs.

Here's the data layout for the wall array:

```wasm
;; Cell2: u8*2      ; left/up cell, right/down cell

;; [0x0100, 0x0310)   Cell2[12*11*2]  walls for Kruskal's algo
```

Now to the code! Here are the steps:

1. Initialize the cell set array
1. Initialize the wall array
1. While the number of walls is not 121:
   1. Pick a random wall from the wall array
   1. Get the cell IDs for this wall
   1. Look up the cell set IDs, `c1` and `c2`, for each cell ID
   1. If the cell set IDs are not equal:
      1. Remove this wall
      1. Loop over all cell set IDs in the grid, and replace `c2` by `c1`

You can see how it works in this interactive demo:

<div class="wasm-demo">
  <div class="iframe-wrapper">
    <iframe width="420" height="480" scrolling="no" src="/assets/2019-10-27-mazegen.html"></iframe>
    <div class="info" style="max-width: 420px">
      Use the &lt; or &gt; buttons to step through the algorithm, or scrub back
      and forth with the slider.
    </div>
    <a href="https://github.com/binji/binji.github.io/blob/master/assets/2019-10-27-mazegen.html">(source)</a>
  </div>
</div>

First we initialize the cell set array. We could do this with a single loop
instead of two loops, but this way we can initialize the wall array in the same
loop:

```wasm
  (local $x i32)
  (local $y i32)
  (local $i i32)

  (loop $y-loop

    (local.set $x (i32.const 0))
    (loop $x-loop
      ;; Each cell is "owned" by itself at the start.
      (i32.store8 (local.get $i) (local.get $i))

      ;; increment cell index.
      (local.set $i (i32.add (local.get $i) (i32.const 1)))

      (br_if $x-loop
        (i32.lt_s
          (local.tee $x (i32.add (local.get $x) (i32.const 1)))
          (i32.const 12))))

    (br_if $y-loop
      (i32.lt_s
        (local.tee $y (i32.add (local.get $y) (i32.const 1)))
        (i32.const 12))))
```

Now we'll initialize the wall array. Outside the loop, we need to add a new
variable `$wall-addr`, which tracks which wall we should add next:

```wasm
(local $wall-addr i32)
(local.set $wall-addr (i32.const 0x100))
```

Inside the loop, we add a vertical wall whenever the x coordinate is less than
11, and a horizontal wall whenever the y coordinate is less than 11.

```wasm
  ;; Add vertical wall, connecting cell i and i + 1.
  (if (i32.lt_s (local.get $x) (i32.const 11))
    (then
      ;; mem[$wall-addr] = $i;
      ;; mem[$wall-addr + 1] = $i + 1;
      ;; $wall-addr += 2;
      (i32.store8
        (local.get $wall-addr)
        (local.get $i))
      (i32.store8 offset=1
        (local.get $wall-addr)
        (i32.add (local.get $i) (i32.const 1)))
      (local.set $wall-addr
        (i32.add (local.get $wall-addr) (i32.const 2)))))

  ;; add horizontal wall, connecting cell i and i + 12.
  (if (i32.lt_s (local.get $y) (i32.const 11))
    (then
      ;; mem[$wall-addr] = $i;
      ;; mem[$wall-addr] = $i + 12;
      ;; $wall-addr += 2;
      (i32.store8
        (local.get $wall-addr)
        (local.get $i))
      (i32.store8 offset=1
        (local.get $wall-addr)
        (i32.add (local.get $i) (i32.const 12)))
      (local.set $wall-addr
        (i32.add (local.get $wall-addr) (i32.const 2)))))
```

The next step is to randomly choose and remove walls, until there are 121
walls. The main loop looks like this:

```wasm
(local.set $walls (i32.const 264))  ;; 12 * 11 * 2
(loop $wall-loop

  ;; loop until there are exactly 11 * 11 walls.
  (br_if $wall-loop (i32.gt_s (local.get $walls) (i32.const 121))))
```

WebAssembly doesn't have a way to generate randomness, but we can import
`Math.random` from JavaScript:

```wasm
(import "Math" "random" (func $random (result f32)))
```

`Math.random` returns a random number in the range \\([0,1)\\), so we can pick
a random wall by multiplying this value by the number of walls and truncating
the result:

```wasm
;; 0x100 is the base address of the array.
;; Shift left by 1 since the wall size is 1.
;;
;; $wall-addr = 0x100 + ((random() * $walls) << 1);
(local.set $wall-addr
  (i32.add
    (i32.const 0x100)
    (i32.shl
      (i32.trunc_f32_s
        (f32.mul
          (call $random)
          (f32.convert_i32_s (local.get $walls))))
      (i32.const 1))))
```

Now we read the cell set IDs, `$c1` and `$c2`:

```wasm
(local.set $c1
  (i32.load8_u (i32.load8_u (local.get $wall-addr))))
(local.set $c2
  (i32.load8_u (i32.load8_u offset=1 (local.get $wall-addr))))
```

If the IDs are not equal, then we remove this wall. We can use the classic
array removal trick where we copy the last element over the one we want to
remove:

```wasm
(if (i32.ne (local.get $c1) (local.get $c2))
  (then
    ;; Remove this wall by copying the last wall over it.
    ;; mem[$wall-addr] = mem[0x100 + (--$walls << 1)];
    (local.set $walls (i32.sub (local.get $walls) (i32.const 1)))
    (i32.store16
      (local.get $wall-addr)
      (i32.load16_u offset=0x100
        (i32.shl (local.get $walls) (i32.const 1))))
    ...
```

then we replace `$c2` with `$c1` everywhere in the grid:

```wasm
(local.set $i (i32.const 0))
(loop $remove-loop
  ;; if (mem[$i] == $c2) mem[$i] = $c1;
  (if (i32.eq (i32.load8_u (local.get $i)) (local.get $c2))
    (then (i32.store8 (local.get $i) (local.get $c1))))

  (br_if $remove-loop
    (i32.lt_s
      (local.tee $i (i32.add (local.get $i) (i32.const 1)))
      (i32.const 144))))
```

Finally we have to use this list of walls to build up the real list of walls
that we want to use in-game. Each wall has two points. We can recover the x and
y coordinate of those points from the cell ID with:

$$
x = \mbox{id} \bmod 12 \\\\
y = \frac{\mbox{id}}{12}
$$

The code isn't very interesting, so I'll omit it here. You can look at the
[source][wall source] if you're curious.

Let's see what our maze looks like!

<div class="wasm-demo">
  <div class="iframe-wrapper">
    <iframe width="400" height="300" src="/assets/2019-10-27-maze.html"></iframe>
    <div class="info" style="max-width: 400px;">
      Use the arrow keys to move, or tap on the left or right side of the screen to turn. <span class="size">1955 bytes</span>.
    </div>
    <a href="https://github.com/binji/binji.github.io/blob/master/assets/2019-10-27-maze.html">(HTML source)</a>
    <a href="https://gist.github.com/binji/964eb4d7c0d7ee09b6de25e3ac2f88d6">(.wat source)</a>
  </div>
</div>

Not bad for 411 extra bytes of code :smile: (we'll shrink this down later.)

## Step 7: Compressing Textures

Right now our textures are taking up 512 bytes, since each one is 32x32 pixels
and 2 bpp. This is pretty good, but we could do better! One way would be to
store the textures compressed, then decompress them at initialization time.

The hard part is making sure that we're actually saving space! Currently we are
spending 512 bytes on textures, and 0 bytes on a decompressor. If we compress
the textures to 256 bytes but need 300 bytes of code to decompress it, we've
failed. :disappointed:

On the other hand, since we're not making a general-purpose compressor, we can
tweak it as much as we want for our data until it compresses well.

In any case, we'll need to make sure that our compression scheme is both pretty
good, but also pretty simple. I usually go for [run-length encoding][RLE]
(RLE).

The basic idea is to encode "runs" of values as a pair of values: a count and a
value. For example, we can encode the string "AAABBBXYZAAAAAAAAABBB" as
"3A3B1X1Y1Z9A3B".

This works well, but if our data has many singletons in a row (i.e. runs of 1),
then this will be bigger than the original data (e.g. "XYZ" becomes "1X1Y1Z").
One trick to work around this is to encode a singleton run by using a negative
count. This is still larger than the original string, but it's a little better.

We're not encoding strings, of course, but bytes. So our decoding will be as
follows, where \\(n\\) and \\(x\\) are bytes, and \\(x^n\\) means a run of
\\(n\\) \\(x\\)'s.

$$
\begin{array}{lcll}
n~x &\Rightarrow& x^n &(\mathrel{\mbox{if} } n >= 0) \\\\
n~x_1~x_2~...~x_{-n} &\Rightarrow& x_1~x_2~...~x_{-n} &(\mathrel{\mbox{otherwise} }) \\\\
\end{array}
$$

This is a little silly, since the \\(n=0\\) case isn't useful, but the
decompression code ends up simpler.

Here's a technique we can use to compress this. It's not how I originally wrote
it, but I think it's nicer this way.

First, we can use `itertools`'s [groupby][] function to produce runs, along
with their length. Because `v` is an iterator, it must be converted to a list
before we can extract the length:

```python
# Step 1: Group runs
data = [(len(list(v)), k) for k, v in groupby(data)]
```

We can use `groupby` a second time to group all singleton and non-singleton
runs:

```python
# Step 2: Group singleton and non-singleton runs
is_singleton = lambda x: x[0] == 1
data = [list(v) for _, v in groupby(data, key=is_singleton)]
```

Now we use a helper function to combine singleton runs, and flatten
non-singleton runs. Note the `256-len(v)` part: this converts the length to a
negative signed 8-bit integer in two's complement format:

```python
# Step 3: Combine singleton runs, flatten others
def combine_singletons(v):
  if is_singleton(v[0]):
    return [256-len(v)] + [x[1] for x in v]
  else:
    return [x for t in v for x in t]
data = [combine_singletons(x) for x in data]
```

And finally we flatten the list of lists:

```python
# Step 4: Flatten all lists
data = [x for l in data for x in l]
```

Try playing with this demo to see how it works:

<div class="wasm-demo">
  <div class="iframe-wrapper">
    <iframe width="420" height="450" src="/assets/2019-10-27-rle-demo.html"></iframe>
    <div class="info" style="max-width: 420px;">
      Use the &lt; or &gt; buttons to step through the algorithm, or scrub back
      and forth with the slider.
    </div>
    <a href="https://github.com/binji/binji.github.io/blob/master/assets/2019-10-27-rle-demo.html">(source)</a>
  </div>
</div>

I made the brick texture less noisy, compressed the textures, and ended a total
of 256 bytes for both!

```wasm
(data (i32.const 0x400)
  ;; brick texture 2bpp RLE compressed
  "\08\aa\04\00\ff\02\03\00\03\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06"
  "\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52"
  "\06\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5"
  "\52\03\55\04\ff\ff\f2\03\ff\08\aa\ff\02\07\00\ff\52\06\55\fe\d5\52\06\55"
  "\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06"
  "\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52\06\55\fe\d5\52"
  "\06\55\fe\d5\52\06\55\fe\d5\f2\07\ff"

  ;; floor and ceiling texture 2bpp RLE compressed
  "\fe\00\56\05\55\fd\02\80\56\05\55\fe\0a\a0\06\55\fe\29\68\06\55\fe\a5\5a"
  "\06\55\ff\95\3b\55\fe\95\5a\06\55\fe\a5\68\06\55\fe\29\a0\06\55\fd\0a\80"
  "\56\05\55\fd\02\00\56\05\55\fd\0a\80\56\05\55\fe\29\a0\06\55\fe\a5\68\06"
  "\55\fe\95\5a\3b\55\ff\5a\06\55\fe\95\68\06\55\fe\a5\a0\06\55\fd\29\80\56"
  "\05\55\ff\0a"
)
```

For the decompressor function, we'll loop over all bytes of the source, and
write to a destination address `0x500`.

```wasm
(func $decompress-textures
  (local $src i32)
  (local $dst i32)

  (local.set $src (i32.const 0x400))
  (local.set $dst (i32.const 0x500))

  (loop $src-loop

    ...

    (local.set $src (i32.add (local.get $src) (i32.const 1)))
    (br_if $src-loop
      (i32.lt_s (local.get $src) (i32.const 0x500)))))
```

For each byte of the source, we read the run count. If the number is negative,
then we read `-count` bytes from the source into the destination. If the
number is positive, then we read one value and duplicate it for `count` bytes.

We can handle both of these cases in the same code by using a `$d-src`
variable: how much to increment `$src` after each step of the run. For a
singleton run, `$d-src` is 1, and for a normal run `$d-src` is 0.

```wasm
;; Load signed 8-bit count from $src.
(local.set $count (i32.load8_s (local.get $src)))

(if (i32.gt_s (local.get $count) (i32.const 0))
  (then
    ;; Run of length $count.
    (local.set $src (i32.add (local.get $src) (i32.const 1)))
    (local.set $d-src (i32.const 0)))
  (else
    ;; -$count singleton elements.
    (local.set $count (i32.sub (i32.const 0) (local.get $count)))
    (local.set $d-src (i32.const 1))))
```

For each byte in the run, we update the source pointer, and read the source
byte:

```wasm
(loop $dst-loop
  (local.set $src (i32.add (local.get $src) (local.get $d-src)))
  (local.set $byte (i32.load8_u (local.get $src)))

  (br_if $dst-loop
    (local.tee $count (i32.sub (local.get $count) (i32.const 1)))))
```

Now that we're processing our textures at runtime, we can simplify our texture
lookup. Instead of using 2bpp lookup in the `$texture` function, we can
decompress into 8bpp textures. The final shift left by 2 is equivalent to
multiplying by 4, to account for the 32-bit RGBA palette entries:

```wasm
;; mem[$dst] = ($byte & 3) << 2;
(i32.store8
  (local.get $dst)
  (i32.shl (i32.and (local.get $byte) (i32.const 3)) (i32.const 2)))

;; mem[$dst+1] = (($byte >> 2) & 3) << 2;
(i32.store8 offset=1
  (local.get $dst)
  (i32.shl
    (i32.and (i32.shr_u (local.get $byte) (i32.const 2)) (i32.const 3))
    (i32.const 2)))

... ;; Similar for for other two bytes.

;; $dst += 4;
(local.set $dst (i32.add (local.get $dst) (i32.const 4)))
```

So how did we do? Well, the final binary is now 1833 bytes, for a savings of
122 bytes. Not bad! (We'll improve this later too).

<div class="wasm-demo">
  <div class="iframe-wrapper">
    <iframe width="400" height="300" src="/assets/2019-10-27-rle.html"></iframe>
    <div class="info" style="max-width: 400px;">
      Use the arrow keys to move, or tap on the left or right side of the screen to turn. <span class="size">1833 bytes</span>.
    </div>
    <a href="https://github.com/binji/binji.github.io/blob/master/assets/2019-10-27-rle.html">(HTML source)</a>
    <a href="https://gist.github.com/binji/729472b4a25520b39e65c96d8e300967">(.wat source)</a>
  </div>
</div>

In the next post (or maybe after), we'll cover:

* Handling collisions with walls
* Making it into a real game
* Shrinking the whole thing back to 2047 bytes!

[part 1]: /posts/raw-wasm-making-a-maze-race/
[start function]: https://webassembly.github.io/spec/core/syntax/modules.html#start-function
[ray]: /assets/2019-10-27-ray.png
[foone]: https://twitter.com/foone
[jamis]: https://twitter.com/jamis
[maze book]: http://www.mazesforprogrammers.com/
[maze blog]: http://weblog.jamisbuck.org/2011/1/3/maze-generation-kruskal-s-algorithm
[wall source]: https://github.com/binji/raw-wasm/blob/0322d4594a1d4348dbabe651af3d114444bb5c4f/maze/maze.wat#L201
[RLE]: https://en.wikipedia.org/wiki/Run-length_encoding
[groupby]: https://docs.python.org/3/library/itertools.html#itertools.groupby
