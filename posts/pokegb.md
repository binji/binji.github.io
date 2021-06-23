---
tags: post
layout: post
title:  "POKEGB: a gameboy emulator that only plays Pokémon blue"
date:   2021-06-03
---

# POKEGB: A gameboy emulator that only plays Pokémon Blue

I recently tweeted out an emulator that I made over the last few days:

<div class="twitter">
<blockquote class="twitter-tweet"><p lang="en" dir="ltr">POKEGB: A gameboy emulator that only plays Pokémon Blue, in 62 lines of c++.<br>source: <a href="https://t.co/AGt7RUTr9H">https://t.co/AGt7RUTr9H</a> <a href="https://t.co/o0BUUmzNOt">pic.twitter.com/o0BUUmzNOt</a></p>&mdash; Ben Smith (@binjimint) <a href="https://twitter.com/binjimint/status/1398311179164872704?ref_src=twsrc%5Etfw">May 28, 2021</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
</div>

In the video, I show some source code that looks like 3 pokéballs, compile it
with gcc, and run it to play Pokémon Blue. The game is controllable, but has no
sound. It renders the graphics w/ 12 colors (shades of red and blue). I choose
BLUE as the name for our hero, and JERK as the name of his rival. The video
ends when Professor Oak stops me from walking into the tall grass.

A lot of folks asked me to do a write-up of how this all works, so let's dive in!

(**TL;DR**: this is a very long writeup, check out the [unobfuscated
code][unobfuscated] instead if you prefer!)

![intro-gif][]

## Stats

But first, let's talk a little about some statistics. The final version in that
tweet is actually 68 lines of code (I tweeted the wrong number!), each line
less than 150 characters long, for a total of 9956 bytes. If you ignore
whitespace and comments, it comes to 4720 bytes. That's too large for the
[International Obfuscated C Code Contest][IOCCC], but pretty close.

Prior to formatting the source code to look like pokéballs, the source was 188
lines and a total of 7786 bytes, with 5954 bytes of non-whitespace source.

## Overview

It'll be useful to know a little about how the gameboy works. This won't go
into all the details (for that you can [read the pandocs][pandocs] or perhaps watch [The Ultimate Gameboy Talk][]), but will
be enough to understand how this code works. Many values are easier to
represent in hexadecimal, so I'll write those with a leading `$`, e.g. `$FE00`.

![pokeprof-gif][]

### CPU

The gameboy CPU is a bit weird &mdash; it's kind of like an [Intel 8080][8080]
and kind of like a [Zilog Z80][z80], but not the same as either. It has an
8-bit accumulator `A`, and three 16-bit register pairs, `BC`, `DE`, and `HL`,
which can be individually accessed as the 8-bit registers `B`, `C`, `D`, `E`,
`H` and `L`. It also has a 16-bit stack pointer `SP`, a 16-bit program counter
`PC`.

| 16-bit | High byte | Low byte | Description |
| - | - | - | - |
| AF | A | - | Accumulator and flags |
| BC | B | C | General purpose |
| DE | D | E | General purpose |
| HL | H | L | General purpose / memory access |
| PC | - | - | Program counter |
| SP | - | - | Stack pointer |

The cpu also has 4 flag bits: `Z`, `N`, `H`, and `C`:

| Flag | Name | Description |
| - | - | - |
| Z | Zero flag | Set when the result is zero |
| N | Subtraction flag | Set if the last instruction was subtract, used for BCD |
| H | Half-carry flag | Set if there is an overflow out of bit 3, used for BCD |
| C | Carry flag | Set if there is an overflow out of bit 7 |

When accessing the AF register (which can only be done via push/pop
instructions), the flags are stored in the most-significant bits of F:

| 15 | 14 | 13 | 12 | 11 | 10 | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| A | A | A | A | A | A | A | A | Z | N | H | C | 0 | 0 | 0 | 0 |

The gameboy instruction set has ~500 instructions, each up to 3 bytes long. For
example, the `NOP` instruction is just one byte (`00`), but the `JP`
instruction is 3 bytes: `$C3` followed by a 16-bit address `$50 $01`.

The instructions can be grouped as follows (taken from [peach.bot's excellent
document][SM83 decoding] on the [Emulation Development discord][emudev
discord]). I've included all instructions, but have struck through the ones
that are not needed for Pokémon Blue. Feel free to skip over this on first
read, I'll go into more detail later:

| 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 | Mnemonic |
| - | - | - | - | - | - | - | - | - |
| 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | NOP |
| 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | ~~LD (u16), SP~~ |
| 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | ~~STOP~~ |
| 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | JR |
| 0 | 0 | 1 <td colspan=2 class="td-colspan"> condition | 0 | 0 | 0 | JR condition |
| 0 | 0 <td colspan=2 class="td-colspan"> r16 (group 1) | 0 | 0 | 0 | 1 | LD r16, u16 |
| 0 | 0 <td colspan=2 class="td-colspan"> r16 (group 2) | 0 | 0 | 1 | 0 | LD (r16), A |
| 0 | 0 <td colspan=2 class="td-colspan"> r16 (group 1) | 0 | 0 | 1 | 1 | INC r16 |
| 0 | 0 <td colspan=2 class="td-colspan"> r16 (group 1) | 1 | 0 | 0 | 1 | ADD HL, r16 |
| 0 | 0 <td colspan=2 class="td-colspan"> r16 (group 2) | 1 | 0 | 1 | 0 | LD A, (r16) |
| 0 | 0 <td colspan=2 class="td-colspan"> r16 (group 1) | 1 | 0 | 1 | 1 | DEC r16 |
| 0 | 0 <td colspan=3 class="td-colspan"> r8 | 1 | 0 | 0 | INC r8 |
| 0 | 0 <td colspan=3 class="td-colspan"> r8 | 1 | 0 | 1 | DEC r8 |
| 0 | 0 <td colspan=3 class="td-colspan"> r8 | 1 | 1 | 0 | LD r8, u8 |
| 0 | 0 <td colspan=3 class="td-colspan"> opcode (group 1) | 1 | 1 | 1 | Opcode Group 1 |
| 0 | 1 | 1 | 1 | 0 | 1 | 1 | 0 | HALT |
| 0 | 1 <td colspan=3 class="td-colspan"> r8 (destination) <td colspan=3 class="td-colspan"> r8 (source) | LD r8, r8 |
| 1 | 0 <td colspan=3 class="td-colspan"> opcode (group 2) <td colspan=3 class="td-colspan"> r8 (operand 2) | ALU A, r8 |
| 1 | 1 | 0 <td colspan=2 class="td-colspan"> condition | 0 | 0 | 0 | RET condition |
| 1 | 1 | 0 <td colspan=2 class="td-colspan"> condition | 0 | 1 | 0 | JP condition |
| 1 | 1 | 0 <td colspan=2 class="td-colspan"> condition | 1 | 0 | 0 | CALL condition |
| 1 | 1 | 0 | 0 | 1 | 1 | 0 | 1 | CALL u16 |
| 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | LD ($FF00 + u8), A |
| 1 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | LD ($FF00 + C), A |
| 1 | 1 | 1 | 0 | 1 | 0 | 0 | 0 | ~~ADD SP, i8~~ |
| 1 | 1 | 1 | 0 | 1 | 0 | 1 | 0 | LD (u16), A |
| 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | LD A, ($FF00 + u8) |
| 1 | 1 | 1 | 1 | 0 | 0 | 1 | 0 | ~~LD A, ($FF00 + C)~~ |
| 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | LD HL, SP + i8 |
| 1 | 1 | 1 | 1 | 1 | 0 | 1 | 0 | LD A, (u16) |
| 1 | 1 <td colspan=2 class="td-colspan"> r16 (group 3) | 0 | 0 | 0 | 1 | POP r16 |
| 1 | 1 <td colspan=3 class="td-colspan"> opcode (group 4) | 0 | 1 | 1 | Opcode group 4  |
| 1 | 1 <td colspan=2 class="td-colspan"> r16 (group 3) | 0 | 1 | 0 | 1 | PUSH r16 |
| 1 | 1 <td colspan=3 class="td-colspan"> opcode (group 2) | 1 | 1 | 0 | ALU A, u8 |
| 1 | 1 <td colspan=3 class="td-colspan"> EXP | 1 | 1 | 1 | ~~RST (call to 00EXP000)~~ |

You can also use the `CB` prefix to access a different set of instructions:

| 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 | Mnemonic |
| - | - | - | - | - | - | - | - | - |
| 0 | 0 <td colspan=3 class="td-colspan"> opcode (group 3) <td colspan=3 class="td-colspan"> r8 | Shift/Rotate |
| 0 | 1 <td colspan=3 class="td-colspan"> bit <td colspan=3 class="td-colspan"> r8 (source) | BIT bit, r8 |
| 1 | 0 <td colspan=3 class="td-colspan"> bit <td colspan=3 class="td-colspan"> r8 (source/dest) | RES bit, r8 |
| 1 | 1 <td colspan=3 class="td-colspan"> bit <td colspan=3 class="td-colspan"> r8 (source/dest) | SET bit, r8 |

`r8` is encoded as:

| value | register |
| - | - |
| 0 | B |
| 1 | C |
| 2 | D |
| 3 | E |
| 4 | H |
| 5 | L |
| 6 | (HL) |
| 7 | A |

`r16` is encoded as:

| value | group 1 | group 2 | group 3 |
| - | - | - | - | - |
| 0 | BC | BC | BC |
| 1 | DE | DE | DE |
| 2 | HL | HL+ | HL |
| 3 | SP | HL- | AF |

`condition` is encoded as:

| value | condition | Meaning |
| - | - | - |
| 0 | NZ | Zero flag is 0 |
| 1 | Z | Zero flag is 1 |
| 2 | NC | Carry flag is 0 |
| 3 | C | Carry flag is 1 |

`opcode` is encoded as:

| value | group 1 | group 2 | group 3 | group 4 |
| - | - | - | - | - |
| 0 | RLCA  | ADD  | RLC  | JP  |
| 1 | RRCA | ADC  | RRC  | CB prefix  |
| 2 | RLA | SUB  | RL | illegal  |
| 3 | ~~RRA~~ | SBC  | RR | illegal  |
| 4 | DAA | AND | SLA | illegal  |
| 5 | CPL | XOR | SRA | illegal  |
| 6 | SCF | OR | SWAP | DI |
| 7 | CCF | CP | SRL | EI |

As you can see, there are many instructions but we can group them into ~40
different categories, 5 of which aren't used by Pokémon Blue (as far as I
know). (Turns out I was wrong, `RRA` is used; see the [TryingToLearn function
in the pokered source][rra use]).

One additional complication is how long each of these instructions take to
execute. This is measured in "T-states", which run at the frequency of the CPU,
~4.19MHz. All instructions operate on a multiple of 4 T-states, which is often
called machine-cycles or "M-cycles".

It's important to keep track of how many M-cycles each instruction takes, since
other hardware components (such as the graphics rendering and audio) take time
too, and we want to make sure that the CPU and these components stay in sync.
Fortunately, the M-cycle counts for most instructions is relatively simple
&mdash; every memory access costs 1 M-cycle (including the cost of reading the
instruction). Some instructions take additional M-cycles, but we can handle
those cases explicitly.

### Memory

The gameboy CPU has a 16-bit address space, divided up into regions with
different purposes. Here's a simplified layout:

| Low | High | Size (in bytes) | Purpose |
| - | - | - | - |
| $0000 | $3FFF | 16384 | Cartridge ROM bank 0 |
| $4000 | $7FFF | 16384 | Cartridge ROM bank 1 |
| $8000 | $9FFF | 8192 | Video RAM |
| $A000 | $BFFF | 8192 | External RAM (often battery-backed) |
| $C000 | $DFFF | 8192 | Work RAM |
| $E000 | $FDFF | 7680 | Mirror of C000-DEFF |
| $FE00 | $FE9F | 160 | Object attribute memory (OAM) |
| $FEA0 | $FEFF | 96 | Unused |
| $FF00 | $FF7F | 128 | Memory-mapped I/O |
| $FF80 | $FFFF | 128 | "High" RAM |

### Memory Bank Controllers

Gameboy cartridges often also use a Memory Bank Controller (MBC), which allows
swapping out regions of ROM and RAM at runtime, as well as other features.
Without this it would be impossible to access more than 32768 bytes of ROM.

Pokémon Blue uses MBC3, which has the ability to swap 64 different 16KiB banks
of ROM (for a total of 1MiB), as well as 4 different of 8KiB banks of External
Ram (for a total of 32KiB). The Pokémon Blue cartridge also has support for a
real-time clock, but I didn't implement support for that.

The way you communicate with the MBC is by writing to various address regions
in ROM (i.e. in the range `$0000-$7FFF`). See the following table for details.
The features that are unimplemented in pokegb have been struck through:

| Low | High | Purpose |
| - | - | - |
| $0000 | $1FFF | ~~External RAM and timer enable~~ |
| $2000 | $3FFF | ROM bank number |
| $4000 | $5FFF | RAM bank number ~~(or RTC register select)~~ |
| $6000 | $7FFF | ~~Latch clock data~~ |

Reading and writing to external RAM can be enabled and disabled. I believe this
was used because the CPU may write garbage data to memory when losing power
(e.g. when the gameboy is switched off). We don't care about that, so we'll
skip implementing it. Fortunately, as far as I can tell, the game doesn't ever
read from or write to this region when it is disabled.

As mentioned before, the cartridge is 1MiB, but the CPU address space is only
64KiB. So to access the rest of the cartridge data we have to remap ROM. Only
ROM bank 1 can be remapped; ROM bank 0 is always mapped to the cartridge's
first 16KiB chunk.

The mapped memory region in ROM bank 1 can be changed by writing a value
between 0 and 63 to any address in the region `$2000-$3FFF`. So for example, if
we write the value 5 to address `$2000`, then the data mapped to addresses
`$4000-$7FFF` will reference the sixth 16KiB ROM bank of the cartridge (which
are the bytes in range `$14000-$17FFF`). The one exception is that if bank 0 is
selected, then the cartridge's second ROM bank is selected instead of the
first.

Similarly, the external RAM address space is only 8KiB, but the available RAM
is 32KiB. Writing a value between 0 and 3 to `$4000-$5FFF` will select a RAM
bank.

### Memory-mapped I/O

The gameboy has 128 bytes of memory-mapped I/O, from address `$FF00` to
`$FF7F`. These addresses are sometimes called registers, not to be confused
with the CPU registers. Not all of these addresses are used by the gameboy, and
not all of the valid addresses are used by Pokémon Blue, and not all of the
addresses used by Pokémon Blue are implemented in pokegb!

Here is a list of the registers used by the original gameboy, with the
unimplemented ones struck through:

| Low | High | Name | Description |
| - | - | - | - |
| $FF00 | $FF00 | JOYP | Joypad input |
| $FF01 | $FF02 | SB / SC | ~~Serial communication~~ |
| $FF04 | $FF04 | DIV | Clock divider |
| $FF05 | $FF07 | TIMA / TMA / TAC | ~~Timer counter / modulo / control~~ |
| $FF0F | $FF0F | IF | Interrupt request |
| $FF10 | $FF3F | - | ~~Sound~~ |
| $FF40 | $FF40 | LCDC | LCD control |
| $FF41 | $FF41 | STAT | ~~LCD status~~ |
| $FF42 | $FF43 | SCY / SCX | Background scroll registers |
| $FF44 | $FF44 | LY | Current Y line being drawn |
| $FF45 | $FF45 | LYC | ~~Y line compare~~ |
| $FF46 | $FF46 | DMA | DMA transfer to OAM |
| $FF47 | $FF47 | BGP | Background palette |
| $FF48 | $FF49 | OBP0 / OBP1 | Object palettes |
| $FF4A | $FF4B | WY / WX | Window location |
| $FFFF | $FFFF | IE | Interrupt enable |

Unfortunately, sound is completely skipped in pokegb. It would be fun to have,
but would require a lot more code, I think.

Several of the registers are used as full 8-bit values (`DIV`, `SCY`, `SCX`,
`LY`, `WY`, `WX`). Others give meaning to individual bits:

| Register | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - | - |
| JOYP | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| JOYP (reading directions) | 1 | 1 | 1 | 0 | ~Down | ~Up | ~Left | ~Right |
| JOYP (reading buttons) | 1 | 1 | 0 | 1 | ~Start | ~Select | ~B | ~A |
| LCDC | LCD enable | Window tile map | Window enable | BG/Window tile data | BG tile map | ~~Object size~~ | Object enable | ~~BG/Window enable~~ |
| IF | 1 | 1 | 1 | ~~Joypad~~ | ~~Serial~~ | ~~Timer~~ | ~~LCD STAT~~ | Vblank |
| IE | 1 | 1 | 1 | ~~Joypad~~ | ~~Serial~~ | ~~Timer~~ | ~~LCD STAT~~ | Vblank |
| BGP <td colspan=2 class="td-colspan"> color 3 <td colspan=2 class="td-colspan"> color 2 <td colspan=2 class="td-colspan"> color 1 <td colspan=2 class="td-colspan"> color 0
| OBP0 <td colspan=2 class="td-colspan"> color 3 <td colspan=2 class="td-colspan"> color 2 <td colspan=2 class="td-colspan"> color 1 <td colspan=2 class="td-colspan"> color 0
| OBP1 <td colspan=2 class="td-colspan"> color 3 <td colspan=2 class="td-colspan"> color 2 <td colspan=2 class="td-colspan"> color 1 <td colspan=2 class="td-colspan"> color 0

As can be seen from the table, reading from the joypad gives different values
depending on whether bits 4 or 5 of `JOYP` are 0. Typically the program will
write to JOYP to read the directions and buttons separately, then later combine
them into one byte. Also, the buttons are labeled with a leading ~ because they
are inverted; e.g. the up direction is pressed when bit 2 is 0.

`LCDC` has a few bits to enable/disable the various rendering layers:
background, window and objects (i.e. sprites). It also has some bits to choose
which region of video RAM is used for map and tile data:

| Bit | 0 | 1 |
| - | - | - |
| Window tile map | $9800-$9BFF | $9C00-$9FFF |
| BG/Window tile data | $8800-$97FF | $8000-$8FFF |
| BG tile map | $9800-$9BFF | $9C00-$9FFF |

The `IF` and `IE` request and enable various interrupt sources, respectively.
If a given interrupt is requested and enabled, and the Interrupt Master Enable
flag (IME) is enabled, then an interrupt is fired. This will cause the CPU to
stop normal execution and jump to an address for the "interrupt handler", the
code that will respond to the interrupt, then return control back to the main
program. Of all of the possible sources, pokegb only supports the vblank
interrupt. The timer and serial interrupts are also used by Pokémon Blue, but
are not implemented.

Finally, the `BGP`, `OBP0`, and `OBP1` registers pick a palette color for the
background and sprites. When rendering graphics, the gameboy can pick from 4
color values, each of which is an index into the appropriate palette. The
palette then chooses what those color values mean:

| Value | Color |
| - | - |
| 0 | White |
| 1 | Light gray |
| 2 | Dark gray |
| 3 | Black |

For pokegb, I decided to use a more fun palette with different colors for BGP,
OBP0, and OBP1.

### Graphics

The gameboy has a 160x144 pixel LCD screen. The graphics hardware (also known
as a Picture Processing Unit or PPU) has the ability to draw one 32x32
scrollable background layer, one 32x32 "window" layer, and up to 40 8x8- or
8x16-pixel sprites. It has 8192 bytes of video RAM to stores the tile and map
data. Each tile stores the pixel colors for an 8x8 block. The gameboy only has
4 colors, so each pixel's color can be represented with only 2 bits, or 4
pixels per byte. As a result, each tile is 16 bytes. The map is an array of
32x32 indexes into the tile data, one byte per tile. So the 32x32 background
and window maps each use 1024 bytes.

It turns out that Pokémon Blue uses the background, window and sprite layers,
but only uses 8x8-pixel sprites.

As shown above, the address of the BG and window maps can be chosen to be
either `$9800-$9BFF` or `$9C00-$9FFF`. Similarly the BG/Window tile data region
can be chosen to be either `$8000-$8FFF` or `$8800-$97FF`. Interestingly, if
`$8800-$97FF` is selected the tile indexes start at `$9000` and wrap around.
So, for example, tile index 127 is at address `$97F0` and tile index 255 is at
address `$8FF0`.

The way the gameboy actually renders the screen is fairly complex (see [Pixel
FIFO in pandocs][pixel fifo]), but we can cheat. Most games (including Pokémon
Blue) don't change any graphics settings while a scanline is drawing. So we can
draw each scanline as it finishes.

Each scanline takes 456 T-states (or 114 M-Cycles) to render. The current
T-state for this scanline is sometimes called a "dot", which has a value
in the range `0-455`. There are a total of 144 scanlines, and 10 lines of
"vertical blank" for a total of 154 lines per screen. So the amount of time it
takes to render a full screen is 70224 T-states (or 17556 M-cycles).

The vertical blank (or vblank) scanlines are a holdover from CRT screens, which
needed this period to reset the electron gun to the upper-left corner of the
screen. This happens to be a useful feature for the gameboy too, even though it
uses an LCD screen instead, since it is a period when the PPU is not accessing
video RAM or other video hardware. This gives the software an opportunity to
update video RAM without affecting the on-screen visuals.

### Window

The window layer is a region displayed over the background layer. It can be
enabled or disabled, and positioned with the `WX` and `WY` registers. When it
is enabled, it always starts at the location `(WX, WY - 7)` and covers the
background in a rectangular region toward the lower-right of the screen. It is
not scrolled by the `SCX` and `SCY` registers.

The window is used in Pokémon Blue to display the title credits, various
animations, menus, etc.

### Sprites

The gameboy hardware supports up to 40 sprites per frame, and up to 10 sprites
per scanline. Each sprite is defined in the OAM and uses 4 bytes. The bytes are
laid out as follows:

| Byte | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - |
| 0 <td colspan=8 class="td-colspan"> Y-coordinate - 16
| 1 <td colspan=8 class="td-colspan"> X-coordinate - 8
| 2 <td colspan=8 class="td-colspan"> Tile index
| 3 | Priority | Y-flip | X-flip | Palette | 0 | 0 | 0 | 0 |

The x- and y-coordinates of the sprite is offset by 8 and 16 pixels,
respectively. This is done so a sprite can be displayed off the left or top
edge of the screen. The sprite will be displayed if the x-coordinate is in the
range 0-167 and the y-coordinate is in the range 0-161, inclusive.

Unlike the BG/Window, the sprite tile data is always at `$8000-$8FFF`, but
otherwise the tile data is displayed the same way.

The priority bit specifies whether this sprite is displayed in front of (0)
or behind (1) the background/window. You can see this effect in Pokémon Blue
when your player walks in the tall grass. It works because the Background color
0 is considered to be transparent, so the sprite will display through.

The x-flip and y-flip bits will flip the displayed sprite horizontally,
vertically, or both, but otherwise will not affect how the sprite is displayed.

The palette bit specifies whether to use `OBP0` or `OBP1` when displaying the
sprite.

### Tiles

The background layer, window layer and sprite layer are all made up of 8x8
tiles. Each tile is 16 bytes, using 2 bits-per-pixel. For each pixel, there
is a low bit and a high bit. The low bit and high bits are stored in separate
bytes, where each byte stores one row:

| Offset | Row | Bit |
| - | - | - |
| 0 | Row 0 | Low bit |
| 1 | Row 0 | High bit |
| 2 | Row 1 | Low bit |
| 3 | Row 1 | High bit |
| 4 | Row 2 | Low bit |
| 5 | Row 2 | High bit |
| 6 | Row 3 | Low bit |
| 7 | Row 3 | High bit |
| 8 | Row 4 | Low bit |
| 9 | Row 4 | High bit |
| 10 | Row 5 | Low bit |
| 11 | Row 5 | High bit |
| 12 | Row 6 | Low bit |
| 13 | Row 6 | High bit |
| 14 | Row 7 | Low bit |
| 15 | Row 7 | High bit |

So for example, if we wanted to draw the pokéball that Ash is tossing on the
title screen:

| Row | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - |
| 1 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">3 <td class="pokepal3">3 <td class="pokepal3">3 <td class="pokepal0">0 <td class="pokepal0">0
| 2 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">3 <td class="pokepal2">2 <td class="pokepal1">1 <td class="pokepal0">0 <td class="pokepal3">3 <td class="pokepal0">0
| 3 <td class="pokepal0">0 <td class="pokepal3">3 <td class="pokepal2">2 <td class="pokepal2">2 <td class="pokepal1">1 <td class="pokepal1">1 <td class="pokepal2">2 <td class="pokepal3">3
| 4 <td class="pokepal0">0 <td class="pokepal3">3 <td class="pokepal2">2 <td class="pokepal2">2 <td class="pokepal2">2 <td class="pokepal2">2 <td class="pokepal2">2 <td class="pokepal3">3
| 5 <td class="pokepal0">0 <td class="pokepal2">2 <td class="pokepal1">1 <td class="pokepal2">2 <td class="pokepal2">2 <td class="pokepal2">2 <td class="pokepal0">0 <td class="pokepal3">3
| 6 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">3 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">3 <td class="pokepal0">0
| 7 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal2">2 <td class="pokepal3">3 <td class="pokepal3">3 <td class="pokepal0">0 <td class="pokepal0">0
| 8 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0

Then we would separate the tile into two [bit planes][bit plane], where the low
bit plane only has the values 0 or 1, and the high bit plane only has the
values 0 or 2. If we add them together for each pixel, we'll get the image
above:

| Row | Low byte | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 | | High byte | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| 1 | $1C <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal3">1 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal0">0 | | $1C <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal0">0 <td class="pokepal0">0
| 2 | $2A <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 | | $32 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal0">0
| 3 | $4D <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal3">1 | | $73 <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal3">2
| 4 | $41 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 | | $7F <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal3">2
| 5 | $21 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 | | $5D <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal0">0 <td class="pokepal3">2
| 6 | $22 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 | | $22 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal0">0
| 7 | $0C <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal0">0 | | $1C <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal3">2 <td class="pokepal0">0 <td class="pokepal0">0
| 8 | $00 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 | | $00 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0

We then interleave these bit planes as shown above to get the 16 bytes for this tile:

```
$1C $1C $2A $32 $4D $73 $41 $7F $21 $5D $22 $22 $0C $1C $00 $00
```

![fight-gif][]

## Making Pokegb

With that out of the way, I'd like to talk a little about how I made pokegb. I
started working on Monday, May 24th. I've already written a gameboy emulator
([binjgb][]), so I knew some of what I'd have to do. But I didn't know a lot
about Pokémon Blue's code. The gameboy actually has a lot of features, and I
didn't know how many Pokémon Blue used. I was hoping that I could avoid
implementing a lot of them to keep the code small.

I decided to start by loading the game in binjgb and tracing the instructions.
The trace output looked like this:

```
A:01 F:Z-HC BC:0013 DE:00d8 HL:014d SP:fffe PC:0100 (cy: 0) ppu:+0 |[00]0x0100: 00        nop
A:01 F:Z-HC BC:0013 DE:00d8 HL:014d SP:fffe PC:0101 (cy: 4) ppu:+0 |[00]0x0101: c3 50 01  jp $0150
A:01 F:Z-HC BC:0013 DE:00d8 HL:014d SP:fffe PC:0150 (cy: 20) ppu:+0 |[00]0x0150: fe 11     cp a,17
A:01 F:-N-C BC:0013 DE:00d8 HL:014d SP:fffe PC:0152 (cy: 28) ppu:+0 |[00]0x0152: 28 03     jr z,+3
A:01 F:-N-C BC:0013 DE:00d8 HL:014d SP:fffe PC:0154 (cy: 36) ppu:+0 |[00]0x0154: af        xor a,a
A:00 F:Z--- BC:0013 DE:00d8 HL:014d SP:fffe PC:0155 (cy: 40) ppu:+0 |[00]0x0155: 18 02     jr +2
A:00 F:Z--- BC:0013 DE:00d8 HL:014d SP:fffe PC:0159 (cy: 52) ppu:+0 |[00]0x0159: ea 1a cf  ld [$cf1a],a
A:00 F:Z--- BC:0013 DE:00d8 HL:014d SP:fffe PC:015c (cy: 68) ppu:+0 |[00]0x015c: c3 54 1f  jp $1f54
...
```

This prints out the CPU state after each instruction, along with a disassembly.

When I started pokegb, I spent most of the first few days implementing the CPU.
Every time I hit an instruction that wasn't implemented, I'd implement it and
see if it would run any further. I made pokegb write a trace output similar to
binjgb, so I could see if they were diverging. Pokegb was significantly less
accurate so unfortunately I couldn't just diff the two trace outputs. Instead I
had to spot check them to see if the output looked way off.

After a few days, the CPU seemed to be in good shape. The game ran for millions
of instructions without failing, and matched binjgb pretty closely. At that
point I started working on rendering the graphics, and added some input. To my
surprise, everything seemed to come together pretty quickly at that point! I
only had a few more instructions to implement, and I was able to walk around,
have conversations, and have battles. I'll admit that I haven't played very far
into the game, so there are very likely bugs!

![caterpillar-gif][]

## Code

Let's dive into the obfuscated code. I've made [an unobfuscated
version][unobfuscated], where I've given the variables better names and
formatted it using clang-format, but have otherwise not changed it.

Let's start at the top.

### Opcode Macros

As mentioned above, most instructions can be grouped into one of ~40
categories. To make it easier to group them, I made 10 different macros:
`OP4_NX8`, `OP4_NX16_REL`, `OP5_FLAG`, `OP8_NX8_REL`, `OP7_PTR`, `OP7_NX8`,
`OP7_NX8_PTR`, `OP49_REL`, `OP56_PTR_REL`, `OP9_IMM_PTR`.

The naming convention I've used is as follows:

* `OPn`: This macro defines `n` instructions.
* `NXm`: Each instruction is spaced out by multiples of `m`.
* `PTR`: This macro also sets the `ptr8` variable, which points to the address
  of the 8-bit source register.
* `REL`: This macro also sets the `opcode_rel` variable, which is the offset of
  the given opcode in its group (e.g. `OP4_NX16_REL` will have `opcode_rel`
  values of 0, 16, 32, or 48). This can be helpful for indexing into a register
  array.
* `IMM`: This macro also defines the "immediate" instruction e.g, `ADD A, u8`.
* `FLAG`: This macro defines an instruction that uses the `condition` codes as
  well as its unconditional version, e.g. `CALL NZ, u16` and `CALL u16`.

Let's take a look at some of the more interesting macros:

First up is `OP5_FLAG`. This macro defines 4 conditional instructions, as well
as the unconditional version. Here the variable `carry` is re-purposed to
determine whether the operation should be performed:

```cpp
#define OP5_FLAG(_, always)                                                    \
  OP4_NX8(_)                                                                   \
  case always:                                                                 \
    carry = (opcode == always) ||                                              \
            (F & F_mask[(opcode - _) / 8]) == F_equals[(opcode - _) / 8];
```

The `F_mask` and `F_equals` arrays are defined to encode
the `condition` table above, and `F` is the flag register:

For example, the condition `NZ` means to execute the instruction if the `Z`
flag is not set. The `Z` flag is bit 7 of the flags register, or 128 in
decimal. So we can tell if `Z` is not set by calculating `(F & 128) == 0`.

```cpp
int F_mask[] = {128, 128, 16, 16},
    F_equals[] = {0, 128, 0, 16};
```

Next is `OP9_IMM_PTR`. This macro defines 9 instructions, one for each entry in
the `r8` table above, as well as for the immediate instruction (which is always
at an offset of 70). Each of these instructions operate on an 8-bit operand:
one of the 7 registers (`A`, `B`, `C`, `D`, `E`, `H`, or `L`), the byte at
address `HL`, or the immediate value `u8`.

The `read8_pc()` function reads the next byte at `PC` (i.e. the next byte in
the instruction stream). The `read8()` function can read a byte at any address,
but defaults to reading the byte at `HL`. And as mentioned above, `ptr8` points
to one of the 8-bit registers.

```cpp
#define OP9_IMM_PTR(_)                                                         \
  case _ + 6:                                                                  \
  case _ + 70:                                                                 \
    OP7_PTR(_)                                                                 \
    operand = (opcode == _ + 6)    ? read8()                                   \
              : (opcode == _ + 70) ? read8_pc()                                \
                                   : *ptr8;
```

### Registers

It's convenient to be able to access most registers both as their 16-bit pairs
or their 8-bit parts. So all CPU registers are defined in an array, along with
their initial values.

These are defined in the order `C`, `B`, `E`, `D`, `L`, `H`, `SP High`, `SP
Low`. This allows us to read a 16-bit register pair directly as long as the
host machine is little-endian. Note that SP is never accessed as an 8-bit
register, so it doesn't need to be defined here; this may be a place where I
could save some additional bytes.

The `A` and `F` registers are used for many of the instructions directly, so we
create references to them by name.

```cpp
uint8_t reg8[] = {19, 0, 216, 0, 77, 1, 176, 1, 254, 255},
        &F = reg8[6],
        &A = reg[7];
```

The `r8` group described above uses the order `B, C, D, E, F, H, L, (HL), A`.
The `reg8_group` array matches this, but uses `&F` instead. This is never
actually used, so it could have been 0 instead to save a byte.

```cpp
uint8_t *reg8_group[] = {reg8 + 1, reg8,
                         reg8 + 3, reg8 + 2,
                         reg8 + 5, reg8 + 4,
                         &F,       &A}
```

There are three `r16` groups above, and each are represented here, with `reg16`
being `r16 (group 3)`. Group 2 is actually meant to be `BC, DE, HL+, HL-`,
where `HL+` and `HL-` use the current value of `HL` and then increment or
decrement, respectively. That behavior is not included here, but instead used
directly in the instructions' implementations via the `HL_add` array.

As with `A` and `F`, `HL` and `SP` are often used directly, so we've created
references to them by name.

```cpp
uint16_t PC = 256,
         *reg16 = (uint16_t *)reg8,
         *reg16_group1[] = {reg16, reg16 + 1, &HL, &SP},
         *reg16_group2[] = {reg16, reg16 + 1, &HL, &HL},
         &HL = reg16[2], &SP = reg16[4];

int HL_add[] = {0, 0, 1, -1};
```

Finally, there is a helper function for setting CPU flags. The `mask` parameter
masks out any flags that are supposed to be set by this instruction, then the
`Z`, `N`, `H`, `C` parameters will set it to their new value. As a size
optimization, the `Z` flag is negated here. That's because many instructions
set the Z flag if the instruction produces a 0 result, so it's convenient to
do the logical not here rather than all places that call `set_flags()`.

```cpp
void set_flags(uint8_t mask, int Z, int N, int H, int C) {
  F = (F & mask) | (!Z * 128 + N * 64 + H * 32 + C * 16);
}
```

### Memory

All the memory for the system is stored in static arrays or memory-mapped regions.

```cpp
uint8_t *rom0, *rom1, *extram, *extrambank;
```

* `rom0`: a pointer to the first 16KiB bank of ROM (addresses `$0000-$3FFF`).
  This is memory-mapped at the beginning of the program.
* `rom1`: a pointer to the currently mapped bank of ROM1 (addresses
  `$4000-$7FFF`).
* `extram`: a pointer to the entire 32KiB of External RAM. This is
  memory-mapped at the beginning of the program.
* `extrambank`: A pointer to the currently mapped 8KiB of External RAM.

```cpp
uint8_t io[512], video_ram[8192], work_ram[16384];
```

* `io`: the 512 bytes from addresses `$FE00-$FFFF`; this includes OAM, I/O, and
  high RAM.
* `video_ram`: 8KiB bytes of video RAM.
* `work_ram`: 16KiB of work RAM, used by the game for any purpose.

The registers `IF`, `LCDC`, `LY`, and `DIV` are used enough times that it saves
source code to reference them by name, rather than via the `io` array:

```cpp
uint8_t &IF = io[271], &LCDC = io[320], &LY = io[324];
uint16_t &DIV = (uint16_t &)io[259];
```

The `frame_buffer` is a `160 * 144 = 23040` buffer, with an `int` for each
pixel. I assume that an `int` is 4-bytes, so it can store a 32-bit RGBA value.

```cpp
int frame_buffer[23040];
int palette[] = {-1,        -23197,    -65536, -16777216, -1,     -8092417,
                 -12961132, -16777216, -1,     -23197,    -65536, -16777216};
```

The palette values look strange, but they are stored as signed-integers to save
in source code size. When written as hexadecimal values, they look more
natural. (Note that these values are stored so the red channel is the
least-significant byte and the alpha channel is the most-significant byte):

| Palette | Color 0 | Color 1 | Color 2 | Color 3 |
| - | - | - | - | - |
| BGP | <code class="pokepal4">0xffffffff</code> | <code class="pokepal5">0xffffa563</code> | <code class="pokepal6">0xffff0000</code> | <code class="pokepal7">0xff000000</code> |
| OBP0 | <code class="pokepal0">0xffffffff</code> | <code class="pokepal1">0xff8484ff</code> | <code class="pokepal2">0xff3a3a94</code> | <code class="pokepal3">0xff000000</code> |
| OBP1 | <code class="pokepal4">0xffffffff</code> | <code class="pokepal5">0xffffa563</code> | <code class="pokepal6">0xffff0000</code> | <code class="pokepal7">0xff000000</code> |

### Memory Access

The CPU can only read or write one byte at a time. The `mem_access()` function
implements both reading and writing to save on source code size. If `write ==
0` then `val` is ignored. If `write != 0`, then the return value is ignored.

First, note that all memory accesses call `tick()`. This increments the cycle
counter by 4, which is the number of T-states required to do an 8-bit memory
access.

As a size-optimization, both `read8()` and `write8()` take `HL` as the default
address. This requires `write8()` to be written "backward", with `val` as the
first parameter and `addr` as the second.

In `mem_access()`, the address is shifted right by 12. This extracts the top
nibble of the address, which can then be used to determine which region of
memory was accessed.

```cpp
void tick() { cycles += 4; }

uint8_t mem_access(uint16_t addr, uint8_t val, int write) {
  tick();
  switch (addr >> 12) {
    ...
  }
}

uint8_t read8(uint16_t addr = HL) { return mem_access(addr, 0, 0); }

void write8(uint8_t val, uint16_t addr = HL) { mem_access(addr, val, 1); }
```

For cases 2 and 3, the address being accessed is in the range `$2000-$3FFF`. If
this region is written to, it will remap ROM bank 1 (see the Memory Bank
Controllers section above). The bank number is shifted left by 14, since each
bank is 1 << 14 = 16KiB.

Either way, we fall through to cases 0 and 1 below. For 0 and 1, the address
being accessed is in the range `$0000-$1FFF`, which is in ROM bank 0.

```cpp
case 2: case 3:
  if (write)
    rom1 = rom0 + ((val ? val & 63 : 1) << 14);

case 0: case 1:
  return rom0[addr];
```

For cases 4 and 5, the address being accessed is in the range `$4000-5FFF`. If
the region is written to, it will remap the External RAM bank. Either way, we
fall through to cases 6 and 7 below, which covers the ROM bank 1 region.

```cpp
case 4: case 5:
  if (write && val <= 3)
    extrambank = extram + (val << 13);

case 6: case 7:
  return rom1[addr & 16383];
```

Cases 8 and 9 are the video RAM region, addresses `$8000-$9FFF`. On the real
gameboy the video RAM cannot be updated during certain times (e.g. when the PPU
is accessing it), but we assume the game is well-behaved and allow it at all
times.

```cpp
case 8: case 9:
  addr &= 8191;
  if (write)
    video_ram[addr] = val;
  return video_ram[addr];
```

Cases 10 and 11 are in the external RAM region, addresses `$A000-$BFFF`. On
real gameboy there are ways to disable read and write access to this region,
but again we assume that the game is well-behaved and allow it at all times.

```cpp
case 10: case 11:
  addr &= 8191;
  if (write)
    extrambank[addr] = val;
  return extrambank[addr];
```

Case 15 is the most complex. Here we first test if the address is greater than
or equal to 65024 (`$FE00`). If so, then we know that we're accessing
somewhere in the `io` region, which includes OAM, I/O, and High RAM.

If the address is a write to 65350 (`$FF46`), then the game is requesting a
DMA transfer to OAM. This is an extremely common way for games to copy sprite
data into OAM, since it is much faster than having the CPU do it manually. The
value written to `$FF46` is used as the high byte of the source address. So,
for example, if the value is `$C1`, then 160 bytes will be copied from
`$C100-$C19F` to OAM.

If the address read from is 65280 (`$FF00`), then the game is reading the
`JOYP` register which gives the current joypad state. The value returned
depends on what was previously written to `JOYP`, either the directions buttons
if bit 4 of `JOYP` is 0, or the face buttons if bit 5 of `JOYP` is 0. If
neither is 0, then `JOYP` returns 255 (`$FF`).

Finally, if the memory access address is less than 65024, then it must be an
access to work RAM, either the primary address range at `$C000-$DFFF`, or the
mirror range at `$E000-$FDFF`. In either case the address is masked and a write
or read is performed.

```cpp
case 15:
  if (addr >= 65024) {
    if (write) {
      if (addr == 65350)
        for (int y = 160; --y >= 0;)
          io[y] = mem_access(val * 256 + y, 0, 0);
      io[addr & 511] = val;
    }
    if (addr == 65280) {
      if (!(io[256] & 16))
        return ~(16 + key_state[SDL_SCANCODE_DOWN] * 8 +
                 key_state[SDL_SCANCODE_UP] * 4 +
                 key_state[SDL_SCANCODE_LEFT] * 2 +
                 key_state[SDL_SCANCODE_RIGHT]);
      if (!(io[256] & 32))
        return ~(32 + key_state[SDL_SCANCODE_RETURN] * 8 +
                 key_state[SDL_SCANCODE_TAB] * 4 +
                 key_state[SDL_SCANCODE_Z] * 2 +
                 key_state[SDL_SCANCODE_X]);
      return 255;
    }
    return io[addr & 511];
  }

case 12 ... 14:
  addr &= 16383;
  if (write)
    work_ram[addr] = val;
  return work_ram[addr];
```

A few more functions are used to reduce code size. First `read8_pc()`
(mentioned above), which reads a byte from the instruction stream.

```cpp
uint8_t read8_pc() { return read8(PC++); }
```

Next `read16()`, which reads a 16-bit value from any address, but defaults to
`PC`. The gameboy CPU is little-endian, so this writes the least-significant
byte first. This function is also used to implement the `POP` instruction. Note
that `addr` must be incremented in separate statements to avoid undefined
behavior.

```cpp
uint16_t read16(uint16_t &addr = PC) {
  tmp8 = read8(addr++);
  return read8(addr++) * 256 + tmp8;
}
```

Then `push()`, which pushes a 16-bit value onto the stack. The most-significant
byte is written first, because the value is written as `SP` is decremented.
Also note that the `tick()` is called because `PUSH` always takes an additional
M-cycle.

```cpp
void push(uint16_t val) {
  write8(val >> 8, --SP);
  write8(val, --SP);
  tick();
}
```

### Initialization

The `main()` function begins by initializing the ROM and External RAM areas:

Since we know that Pokémon Blue is 1MiB, we can directly `mmap` it. This saves
some space over `fopen`/`fread` as long as we use numbers instead of
`PROT_READ`, etc.

```cpp
int main() {
  rom1 = (rom0 = (uint8_t *)mmap(0, 1048576, PROT_READ, MAP_SHARED,
                                 open("rom.gb", O_RDONLY), 0)) +
         32768;
  ...
}
```

Similarly, we can `mmap` the External RAM file, though this is even more
convenient since any writes to this region will automatically be written to the
save file.

One slightly annoying quirk is that the file must be truncated to the correct
length, or else writes will crash the emulator. This behavior seems to work on
Linux, but fails on macOS (see [pokegb issue 1][]):

```cpp
tmp = open("rom.sav", O_CREAT|O_RDWR, 0666);
ftruncate(tmp, 32768);
extrambank = extram =
    (uint8_t *)mmap(0, 32768, PROT_READ | PROT_WRITE, MAP_SHARED, tmp, 0);
```

The `LCDC` and `DIV` I/O registers are set to initial values to match binjgb.
It's likely that this isn't actually required, and could be removed to save
some bytes.

```cpp
LCDC = 145;
DIV = 44032;
```

Next we initialize SDL:

```cpp
SDL_Init(SDL_INIT_VIDEO);
```

Then create a window at 5x the gameboy resolution, along with a renderer that can draw to it:

```cpp
SDL_Renderer *renderer = SDL_CreateRenderer(
    SDL_CreateWindow("pokegb", 0, 0, 800, 720, SDL_WINDOW_SHOWN), -1,
    SDL_RENDERER_PRESENTVSYNC);
```

And create a texture at the gameboy resolution that we will lock and draw to
later:

```cpp
SDL_Texture *texture = SDL_CreateTexture(
    renderer,
    SDL_PIXELFORMAT_RGBA32,
    SDL_TEXTUREACCESS_STREAMING,
    160, 144);
```

And finally grab the keyboard state array. Conveniently, this will be
automatically updated by SDL whenever we poll for events:

```cpp
key_state = SDL_GetKeyboardState(0);
```

![old-man-gif][]

### CPU

After initialization, we start a loop that steps the CPU and updates the
graphics. There are a few different states that the CPU can be in: running
normally, "halted" waiting for an interrupt, and handling an interrupt.

That is all handled at the start of the loop:

```cpp
while (1) {
  prev_cycles = cycles;
  if (IME & IF & io[511]) {
    IF = halt = IME = 0;
    cycles += 8;
    carry = 1;
    temp16 = 64;
    goto CALL;
  } else if (halt)
    tick();
  else
    switch (opcode = read8_pc()) {
      ...
    }
  ...
}
```

First, the the current cycle counter is saved so we know how many cycles to
update the PPU later. Then we check if any bit is set in all of Interrupt
Master Enable flag (`IME`), Interrupt Request (`IF`), and Interrupt Enable
(`io[511]`). Since pokegb only supports the vblank interrupt, then we know that
we only need to check for bit 0, but it's smaller to check for any bit here.

If an interrupt occurs, the CPU is no longer halting, and the `IME` and `IF`
flags are cleared. The CPU then performs the equivalent of a `CALL` to address
`$0040` (64) which is the vblank interrupt handler.

If the CPU is halted, then we simply tick the clock and loop until an interrupt
occurs.

Otherwise, we read the next byte in the instruction stream and try to execute
it.

![no-entry-gif][]

### Instructions

This is the real meat of the emulator. As we saw above, there are a lot of
instructions, and most of them are needed to run Pokémon Blue. Let's start with
the simplest instruction, `NOP`, which does nothing:

```cpp
case 0: // NOP
  break;
```

Off to a good start! Next is `LD r16, u16`, which copies a 16-bit value from
the instruction stream into a 16-bit register pair. This handles opcodes 1, 17,
33, and 49. Since these opcodes are spaced by multiples of 16, we can shift
right by 4 to index into `r16 (group 1)`:

```cpp
OP4_NX16_REL(1) // LD r16, u16
  *reg16_group1[opcode >> 4] = read16();
  break;
```

Next up, `LD (r16), A`, which writes `A` into memory at a given address. This
also can optionally increment or decrement `HL`. Notice that we use
`opcode_rel` for this; it's not required in this case since `opcode / 16` is
equal to `opcode_rel / 16`. But for other instructions it will be useful:

```cpp
OP4_NX16_REL(2) // LD (r16), A
  write8(A, *reg16_group2[opcode >> 4]);
  HL += HL_add[opcode_rel / 16];
  break;
```

Then `INC r16` and `DEC r16`, which increment or decrement a register pair.
These take an additional M-cycle, so `tick()` is called.

```cpp
OP4_NX16_REL(3) // INC r16
  (*reg16_group1[opcode >> 4])++;
  tick();
  break;

OP4_NX16_REL(11) // DEC r16
  (*reg16_group1[opcode >> 4])--;
  tick();
  break;
```

Likewise there are `INC r8` and `DEC r8` which increment or decrement an 8-bit
register. Unlike their 16-bit equivalents, these update CPU flags. `goto` is
used to share some code:

```cpp
OP7_NX8_PTR(4) // INC r8
  tmp8 = ++(*ptr8);
  goto INC_FLAGS;

OP7_NX8_PTR(5) // DEC r8
  tmp8 = --(*ptr8);
  goto DEC_FLAGS;
```

The `r8` group also includes `(HL)`, which means to use the byte at the address
`HL` instead. It is simpler to handle these separately, using `read8()` and
`write8()`.

These instructions also have the code to handle setting flags. Remember that
the first parameter is the mask. 16 is the value of the carry flag, so this
mask means that the carry flag will be preserved. The other flags are set
according to the rest of the arguments: `Z` is set if the result is zero, `N`
is set if the operation was a decrement, and `H` is set if there was an
overflow to bit 4 of the result.

```cpp
case 52: // INC (HL)
  write8(tmp8 = read8() + 1);
INC_FLAGS:
  set_flags(16, tmp8, 0, !(tmp8 & 15), 0);
  break;

case 53: // DEC (HL)
  write8(tmp8 = read8() - 1);
DEC_FLAGS:
  set_flags(16, tmp8, 1, tmp8 % 16 == 15, 0);
  break;
```

Next is `LD r8, u8`, which loads a value from the instruction stream into a
register or `(HL)`.

```cpp
OP7_NX8_PTR(6) // LD r8, u8
  *ptr8 = read8_pc();
  break;

case 54: // LD (HL), u8
  write8(read8_pc());
  break;
```

Next, `RLCA` and `RRCA`, which rotate the `A` register left or right by one
bit. The bit that is rotated out is copied to the carry flag, as well as moved
to the other end.

`A += A` is used instead of `A << 1`, and `A / 2` is used instead of `A >> 1`
to reduce code size.

```cpp
case 7: // RLCA
  A += A + (carry = A >> 7);
  goto CARRY_FLAG;

case 15: // RRCA
  A = (carry = A & 1) * 128 + A / 2;
  goto CARRY_FLAG;
```

`RLA` is similar to `RLCA`, but it rotates the `A` register "through" the carry
flag, meaning that it is a 9-bit rotate. Bit 7 of `A` is moved into the carry
flag, and the carry flag is moved into bit 0 of `A`.

When the flags are set, the mask is 0, which means that all flags are set: `Z`
is always 1, `N` and `H` are 0, and `C` is set to `carry`:

The expression `F / 16 % 2` looks odd, but extracts the carry bit from `F` into
bit 0.

```cpp
case 23: // RLA
  carry = A >> 7;
  A += A + F / 16 % 2;
CARRY_FLAG:
  set_flags(0, 1, 0, 0, carry);
  break;
```

Now onto the `JR` instructions. They branch the `PC` to a new location,
relative to where the current `PC` is, either forward or backward. That's why
`tmp8` is cast to an `int8_t`. The `carry` variable is used as a condition,
which is automatically set by the `OP5_FLAG` macro. Notice also that this uses
the comma operator to save a byte of source code.

```cpp
OP5_FLAG(32, 24) // JR i8 / JR <condition>, i8
  tmp8 = read8_pc();
  if (carry)
    PC += (int8_t)tmp8, tick();
  break;
```

Next is a beast of an instruction, Decimal Adjust for Addition (`DAA`). It's
intended to be used for handling arithmetic on [Binary Coded Decimal][bcd]
(BCD) values.

The basic idea is relatively simple: a two-digit decimal number can be stored
in a byte where each nibble stores one digit. For example, the decimal number
42 can be stored as the hexadecimal number `$42` (66). This is useful for
older harware that didn't have a divide instruction, like the gameboy.

`DAA` is used after addition or subtraction to fix the BCD value. So if we take
the decimal numbers 42 and add 9, we expect to get 51. But if we do this with
BCD values, we'll get `$4B` instead. Executing `DAA` after this addition will
adjust `$4B` to `$51` as expected.

The first `if` determines whether we need to adjust the least-significant
nibble, and the second `if` determines whether we need to adjust the
most-significant nibble. The adjustment value added to (or subtracted from) `A`
is either `$00`, `$06`, `$60`, or `$66`, depending on the values of the `H`,
`C`, and `N` flags, and the current value of the `A` register.

For our example, `$06` will be added to `$4B` to produce `$51`.

```cpp
case 39: // DAA
  carry = tmp8 = 0;
  if (F & 32 || (!(F & 64) && A % 15 > 9))
    tmp8 = 6;
  if (F & 16 || (!(F & 64) && A > 153))
    tmp8 |= 96, carry = 1;
  set_flags(65, A += (F & 64) ? -tmp8 : tmp8, 0, 0, carry);
  break;

```

Now a simpler one, `CPL`. This instruction performs the [ones' complement][] of
`A`, which means flipping all of its bits.

```cpp
case 47: // CPL
  A = ~A;
  set_flags(129, 1, 1, 1, 0);
  break;
```

`SCF` and `CCF` set or complement the carry flag. The implementation combines
them to save on space.

```cpp
case 55: case 63: // SCF / CCF
  set_flags(128, 1, 0, 0, opcode == 55 ? 1 : !(F & 16));
  break;
```

The `LD r8, (HL)` and `LD (HL), r8` instructions read from or write to memory.
In this case there is an exception to the pattern; normally the `r8` group
includes `(HL)`, but there is no `LD (HL), (HL)` instruction. That instruction
is instead `HALT`.

```cpp
OP7_NX8_PTR(70) // LD r8, (HL)
  *ptr8 = read8();
  break;

OP7_PTR(112) // LD (HL), r8
  write8(*ptr8);
  break;
```

Speaking of which, here's `HALT`. On the real gameboy, there are some
complexities with how `HALT` behaves, but here we merely set the `halt`
variable to 1.

```cpp
case 118: // HALT
  halt = 1;
  break;
```

The `LD r8, r8` group covers 49 different instructions, not including `(HL)`.
It has several seemingly redundant instructions, such as `LD B, B` and `LD C,
C`. Some emulators use these instructions as a breakpoint instead, since they
otherwise have no purpose:

```cpp
OP49_REL(64) // LD r8, r8
  *reg8_group[opcode_rel / 8] = *reg8_group[opcode & 7];
  break;
```

Here's one of the trickier set of instructions. There are 4 different
operations handled here: addition (`ADD`), addition with carry (`ADC`),
subtraction (`SUB`), and subtraction with carry (`SBC`). In other words, each
instruction does the following:

* `ADD`: `A = A + operand + 0`
* `ADC`: `A = A + operand + carry`
* `SUB`: `A = A - operand - 0`
* `SBC`: `A = A - operand - carry`

They all can be implemented using the same code. In regular mathematics, we can
rewrite subtraction as addition (e.g. `3 - 5 = 3 + -5`). We can do the same for
[two's complement][] arithmetic, but instead of negating the operand, we can
complement it (`~`) and add one, which is equivalent:

* `ADD`: `A = A + operand + 0`
* `ADC`: `A = A + operand + carry`
* `SUB`: `A = A + ~operand + 1 - 0`
* `SBC`: `A = A + ~operand + 1 - carry`

But since `carry` is either 0 or 1, we can simplify this to:

* `ADD`: `A = A + operand + 0`
* `ADC`: `A = A + operand + carry`
* `SUB`: `A = A + ~operand + 1`
* `SBC`: `A = A + ~operand + ~carry`

The only additional complication is how to deal with the flags. The `N` flag is
simplest, it is 0 for addition and 1 for subtraction. The `H` flag is set
if there is an overflow into bit 4 of the result. It turns out that we can
correctly calculate this by seeing if the sum of the low nibbles of `A`,
`operand`, and `carry` is greater than 15. For subtraction, we take this
result and flip it, i.e. we only set the `H` flag if the sum is _not_ greater
than 15. Similarly, the `C` flag checks for an overflow out of bit 7 of the
result, so we check whether the sum `A + operand + carry` is greater than 255.

```cpp
OP9_IMM_PTR(128) // ADD A, r8 / ADD A, (HL) / ADD A, u8
  neg = carry = 0;
  goto ALU;

OP9_IMM_PTR(136) // ADC A, r8 / ADC A, (HL) / ADC A, u8
  neg = 0;
  carry = F / 16 % 2;
  goto ALU;

OP9_IMM_PTR(144) // SUB A, r8 / SUB A, (HL) / SUB A, u8
  carry = 1;
  goto SUBTRACT;

OP9_IMM_PTR(152) // SBC A, r8 / SBC A, (HL) / SBC A, u8
  carry = !(F / 16 % 2);
SUBTRACT:
  neg = 1;
  operand = ~operand;
ALU:
  set_flags(0, tmp8 = A + operand + carry, neg,
            (A % 16 + operand % 16 + carry > 15) ^ neg,
            (A + operand + carry > 255) ^ neg);
  A = tmp8;
  break;
```

Next are the common bitwise operations, `AND`, `OR`, and `XOR`. They are
relatively straightforward since c++ has built-in operators for them:

```cpp
OP9_IMM_PTR(160) // AND A, r8 / AND A, (HL) / AND A, u8
  set_flags(0, A &= operand, 0, 1, 0);
  break;

OP9_IMM_PTR(168) // XOR A, r8 / XOR A, (HL) / XOR A, u8
  set_flags(0, A ^= operand, 0, 0, 0);
  break;

OP9_IMM_PTR(176) // OR A, r8 / OR A, (HL) / OR A, u8
  set_flags(0, A |= operand, 0, 0, 0);
  break;
```

Next up is the collection of `CP` instructions. They have the same behavior as
`SUB`, except they don't modify `A`, only the CPU flags:

```cpp
OP9_IMM_PTR(184) // CP A, r8 / CP A, (HL) / CP A, u8
  set_flags(0, A != operand, 1, A % 16 < operand % 16, A < operand);
  break;
```

Now we get to the set of `RET` instructions. They return from a function call
by popping the return address off of the stack. Like the `JR` instructions
above, they come in "conditional" and "unconditional" flavors. The `OP5_FLAG`
macro sets `carry` to the result of the condition. But there's also `RETI`,
which is the same as `RET` followed by `EI` (enable interrupts).

```cpp
case 217: // RETI
  carry = IME = 1;
  goto RET;

OP5_FLAG(192, 201) // RET / RET <condition>
RET:
  tick();
  if (carry)
    PC = read16(SP);
  break;
```

Then onto `PUSH` and `POP` instructions. These write to or read from the stack,
and then move the stack pointer accordingly. They don't have to be used for
stack access, however. Pokémon Blue actually uses them to decode some graphics
during vblank, since `POP` is a fast way to read 16 bits into a register pair.

```cpp
OP4_NX16_REL(193) // POP r16
  reg16[opcode_rel >> 4] = read16(SP);
  break;

OP4_NX16_REL(197) // PUSH r16
  push(reg16[opcode_rel >> 4]);
  break;
```

The `JP` instructions is similar to the `JR` instructions, except that the jump
is absolute instead of relative.

```cpp
OP5_FLAG(194, 195) // JP u16 / JP <condition>, u16
  temp16 = read16();
  if (carry)
    PC = temp16, tick();
  break;
```

The `CALL` instructions are similar to the `JP` instructions, but the also push
the old `PC` to the stack first:

```cpp
OP5_FLAG(196, 205) // CALL u16 / CALL <condition>, u16
  temp16 = read16();
CALL:
  if (carry)
    push(PC), PC = temp16;
  break;
```

The gameboy also has some instructions to make it easier to access the top 256
bytes of the address space (`$FF00-$FFFF`). The byte offset is either read from
the instruction stream as `($FF00 + u8)` or from the `C` register as `($FF00 + C)`.

The `LD A, (u16)` instruction is also implemented here, which reads an address
from memory, then reads that byte into the `A` register. Its implementation is
combined with `LD A, ($FF00 + u8)` to save space.

```cpp
case 224: case 226: // LD ($FF00 + u8), A / LD ($FF00 + C), A
  write8(A, 65280 + (opcode == 224 ? read8_pc() : *reg8));
  break;

case 240: case 250: // LD A, ($FF00 + u8) / LD A, (u16)
  A = read8(opcode == 240 ? 65280 | read8_pc() : read16());
  break;
```

The counterpart to `LD A, (u16)` is `LD (u16), A`, which reads an address from
the instruction stream, then writes the value in the `A` register to that
address. This probably could have been combined with case 224 and 226 above
to save space.

```cpp
case 234: // LD (u16), A
  write8(A, read16());
  break;
```


All of the other jump instructions we've seen so far take an immediate offset
or address, but `JP HL` is used when you want to jump to an arbitrary address,
for example, to implement a jump table.

```cpp
case 233: // JP HL
  PC = HL;
  break;
```

The Interrupt Master Enable (`IME`) flag can be modified with the `DI` and `EI`
instructions, either disabling or enabling the flag.

```cpp
case 243: case 251: // DI / EI
  IME = opcode != 243;
  break;
```

Finally, there are two instructions that copy between `HP` and `SP`. The `LD
HL, SP + i8` adds a signed value to `SP` and stores it in the `HL` register. On
the other hand, `LD SP, HL` just copies the `HL` register directly into `SP`.

```cpp
case 248: // LD HL, SP + i8
  tmp8 = read8_pc();
  set_flags(0, 1, 0, (uint8_t)SP + tmp8 > 255, SP % 16 + tmp8 % 16 > 15);
  HL = SP + (int8_t)tmp8;
  tick();
  break;

case 249: // LD SP, HL
  SP = HL;
  tick();
  break;
```

![bug-catcher-gif][]

### $CB Instructions

The `$CB` instruction is an instruction prefix. All `$CB` instructions are two
bytes, and the second byte determines which operation it is (see opcode group 3
above).

First off are `RLC` and `RRC`, which are similar to `RLCA` and `RRCA` above but
can be used for any register (as well as `HL`) Interestingly, the `RRC (HL)`
instruction is also used by Pokémon Blue, but `RLC (HL)` doesn't seem to be. It
works the same as `RRC r8`, but operates on the memory at `(HL)`:

```cpp
OP7_PTR(0) // RLC r8
  *ptr8 += *ptr8 + (carry = *ptr8 / 128 % 2);
  goto CARRY_ZERO_FLAGS_PTR;

OP7_PTR(8) // RRC r8
  *ptr8 = (carry = *ptr8 & 1) * 128 + *ptr8 / 2;
  goto CARRY_ZERO_FLAGS_PTR;

case 14: // RRC (HL)
  tmp8 = read8();
  carry = tmp8 & 1;
  write8(tmp8 = carry * 128 + tmp8 / 2);
  goto CARRY_ZERO_FLAGS_TMP;
```

Next are `RL` and `RR`. Like `RLA` and `RRA` above, these rotate "through" the
carry flag for a 9-bit rotate, but they can be used for any register.

```cpp
OP7_PTR(16) // RL r8
  carry = *ptr8 >> 7;
  *ptr8 = *ptr8 * 2 + F / 16 % 2;
  goto CARRY_ZERO_FLAGS_PTR;

OP7_PTR(24) // RR r8
  carry = *ptr8 & 1;
  *ptr8 = *ptr8 / 2 + (F * 8 & 128);
  goto CARRY_ZERO_FLAGS_PTR;
```

Now Shift Left Arithmetic (`SLA`) and Shift Right Arithmetic (`SRA`).
"Arithmetic" means that `SRA` behaves like a signed divide by 2. In two's
complement, that means that the most-significant bit (i.e. the sign bit) is not
changed. For example, performing `SRA` on `$43` (67 in decimal, `01000011` in
binary) results in `$21` (33 in decimal, `00100001` in binary). On the other
hand, performing `SRA` on `$F0` (-16 in decimal, `11110000` in binary)
results in `$F8` (-8 in decimal, `11111000` in binary).

```cpp
OP7_PTR(32) // SLA r8
  carry = *ptr8 / 128 % 2;
  *ptr8 *= 2;
  goto CARRY_ZERO_FLAGS_PTR;

OP7_PTR(40) // SRA r8
  carry = *ptr8 & 1;
  *ptr8 = (int8_t)*ptr8 >> 1;
  goto CARRY_ZERO_FLAGS_PTR;
```

On the other hand, Shift Right Logical (`SRL`) fills 0 into the
most-significant bit after a shift. So for example, performing `SRL` on `$F0`
(240 in decimal, `11110000` in binary) results in `$78` (120 in decimal,
`01111000` in binary).

```cpp
OP7_PTR(56) // SRL r8
  carry = *ptr8 & 1;
  *ptr8 /= 2;
CARRY_ZERO_FLAGS_PTR:
  set_flags(0, *ptr8, 0, 0, carry);
  break;
```


The `SWAP` instructions swap the low and high nibble of the byte. For example,
`SWAP` on `$A3` results in `$3A`.

```cpp
OP7_PTR(48) // SWAP r8
  set_flags(0, *ptr8 = *ptr8 * 16 + *ptr8 / 16, 0, 0, 0);
  break;

case 54: // SWAP (HL)
  tmp8 = read8();
  carry = 0;
  write8(tmp8 = tmp8 * 16 + tmp8 / 16);
CARRY_ZERO_FLAGS_TMP:
  set_flags(0, tmp8, 0, 0, carry);
  break;
```

The `BIT` instructions check whether a given bit is set, and set the `Z` flag
accordingly. The bit to check is encoded in the opcode itself, so we can use
`opcode_rel / 8` to extract it:

```cpp
OP8_NX8_REL(70) // BIT bit, r8
  tmp8 = read8();
  goto BIT_FLAGS;

OP56_PTR_REL(64) // BIT bit, (HL)
  tmp8 = *ptr8;
BIT_FLAGS:
  set_flags(16, tmp8 & (1 << opcode_rel / 8), 0, 1, 0);
  break;
```

The `RES` instructions reset (i.e. clear) a given bit in an 8-bit register or
`(HL)`. Again, the bit to clear is encoded in the opcode.

```cpp
OP8_NX8_REL(134) // RES bit, (HL)
  write8(read8() & ~(1 << opcode_rel / 8));
  break;

OP56_PTR_REL(128) // RES bit, r8
  *ptr8 &= ~(1 << opcode_rel / 8);
  break;
```

And finally, the `SET` instructions set a given bit in an 8-bit register or
`(HL)`.

```cpp
OP8_NX8_REL(198) // SET bit, (HL)
  write8(read8() | 1 << opcode_rel / 8);
  break;

OP56_PTR_REL(192) // SET bit, r8
  *ptr8 |= 1 << opcode_rel / 8;
  break;
```

With that, we've completed the CPU implementation, in 1955 bytes (after
removing all unnecessary whitespace).

![heal-gif][]

### Graphics

Now that we've executed the CPU, we want the PPU to catch up. The current CPU
cycle count is in `cycles`, and the cycle count before executing the
instruction is in `prev_cycles`. So we can update the PPU by `cycles -
prev_cycles` T-states.

The `DIV` I/O register counts the number of T-states as well, but only stores
the high byte of this value at address `$FF04`. Fortunately `$FF03` is left
unused, so we can treat `DIV` as a 16-bit value starting at `$FF03` instead,
and increment it directly:

```cpp
for (DIV += cycles - prev_cycles; prev_cycles++ != cycles;)
  ...
```

First off, we only want to draw the screen if the LCD is enabled (see `LCDC`
bit 7). So we check for that, and otherwise reset the current PPU dot and the
current scanline counter to zero (since it means that the screen is off):

```cpp
if (LCDC & 128) {
  ...
} else
  LY = ppu_dot = 0;
```

Next we want to trigger a vblank interrupt when the screen is finished
rendering. This happens after the 143rd line finishes, so we check whether the
current "dot" was 0, and whether the current scanline is 144, and set the
interrupt request to 1. This could have been just `IF=1`, since we don't
support any other interrupts:

```cpp
if (++ppu_dot == 1 && LY == 144)
  IF |= 1;
```

After that is the fun bit, actually drawing a scanline! Since we're keeping
things simple, we only render a scanline when it finishes, at dot 456. It is
possible on the real gameboy to modify PPU settings during the scanline, but
those don't happen in Pokémon Blue.

After rendering the line, we increment `LY` and reset `ppu_dot` back to 0.

```cpp
if (ppu_dot == 456) {
  ...

  LY = (LY + 1) % 154;
  ppu_dot = 0;
}
```

If the current scanline is less than 144, we draw it. This includes rendering
the background and window layers, and any sprites that are on this line. We
loop over every x-coordinate as `tmp`:

```cpp
if (LY < 144)
  for (tmp = 160; --tmp >= 0;) {
    ...
  }
```

First we want to determine if we're drawing the window layer or the background
layer. Like everything else, the real logic to determine this is somewhat
complex, but we can do a simpler version. If the window is enabled, and the
current pixel we're drawing `(tmp, LY)` is greater than the upper-left
coordinate of the window `(WX - 7, WY)`, then we are drawing the window. Recall
from above that `WY` is `io[330]` and `WX` is `io[331]`:

```cpp
uint8_t is_window =
            LCDC & 32 &&
            LY >= io[330] &&
            tmp >= io[331] - 7;
```

Now we want to find out the pixel offset of the current pixel, either into the
background map or the window map. If this pixel is displaying the background,
then we offset by the background scroll registers `(SCX, SCY)`. If instead this
pixel is displaying the window, then we offset by the window's upper left
corner `(WX - 7, WY)`. Again, note that `SCX` is `io[323]` and `SCY` is
`io[322]`:

```cpp
uint8_t x_offset = is_window ? tmp - io[331] + 7 : tmp + io[323],
        y_offset = is_window ? LY - io[330] : LY + io[322];
```

Now that we know the pixel offset, we can determine which tile is being drawn.
The background and window maps start at either address `$9800` or `$9C00`,
depending on the settings in `LCDC`. Since we're reading from video RAM
directly (rather than through the `read8()` function), we want to use the
offset into video RAM instead, `$1800` or `$1C00`. This can be rewritten as `$6
<< 10` and `$7 << 10`.

The window map is at `$1C00` if `LCDC` bit 6 is set (`== 64`), and the
background map is at `$1C00` if `LCDC` bit 3 is set (`== 8`). So we can
determine the base map address by checking the correct bit, depending on
`is_window`.

Finally, the tile offset within the map can be found by taking the pixel offset
and dividing by 8, since there are 8 pixels per tile in both dimensions.
The map is 32x32 tiles, and each tile is one byte, so multiplying the y tile
offset by 32 gives the final expression.

We also set the `palette_index` to 0 by default (which means to use `BGP`).

```cpp
uint16_t tile =
  video_ram[((LCDC & (is_window ? 64 : 8) ? 7 : 6) << 10) +
            y_offset / 8 * 32 + x_offset / 8],
  palette_index = 0;
```

Now that we know which tile is being rendered, we have to read the pixel data
for that tile. The starting address of the tile data is either `$8000` or
`$8800`. But as mentioned above, if the starting address is `$8800`, then
tile 0 is actually at address `$9000`, and then the tile indexes wrap
around back to `$8800` at tile index 128. `LCDC` bit 4 (`== 16`) determines
this behavior.

We can get the pixel row of the tile to draw with the expression `y_offset %
8`. Each row is 2 bytes (since it has two bitplanes) and each tile is 16
bytes:

```cpp
uint8_t *tile_data =
  &video_ram[(LCDC & 16 ? tile : 256 + (int8_t)tile) * 16 +
             y_offset % 8 * 2];
```

This gives us the low byte of this row in `tile_data[0]` and the high byte in
`tile_data[1]`. `x_offset & 7` will give us the offset of the current pixel in
this tile's row. However, you may have noticed above that a tile's row has the
leftmost pixel as the most-significant bit. So, for example, if we are at pixel
offset 0, we want to use bit 7 of the row. This means that the amount to
shift right is actually `7 - x_offset`, which is the same as `x_offset ^ 7`.

```cpp
x_offset = (x_offset ^ 7) & 7;

uint8_t color =
  (tile_data[1] >> x_offset) % 2 * 2 +
  (*tile_data >> x_offset) % 2;
```

Let's say we're drawing the fifth pixel of the second row of Ash's pokéball:

| Byte | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - |
| Low <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal3 pokeborder">1 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 |
| High <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal3">1 <td class="pokepal0 pokeborder">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 |

Then `x_offset` is 3, so when we shift right by 3, we get:

| Byte | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - |
| Low <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal0">0 <td class="pokepal3 pokeborder">1 |
| High <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3">1 <td class="pokepal3">1 <td class="pokepal0 pokeborder">0 |

Then we perform `% 2`:

| Byte | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - |
| Low <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3 pokeborder">1 |
| High <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0 pokeborder">0 |

And then we shift the high byte left by 1, and add the bytes together:

| Byte | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - |
| Both <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal0">0 <td class="pokepal3 pokeborder">1 <td class="pokepal0 pokeborder">0 |

This gives us a final color of 2.

After we've calculated the background or window pixel color, we may have to
draw a sprite on top of it. Sprites can be enabled or disabled with bit 1 of
`LCDC`:

```cpp
if (LCDC & 2)
  ...
```

OAM has enough space for 40 sprites, each one requiring 4 bytes. On a real
gameboy only 10 sprites can be drawn per scanline, but we'll ignore that
limit. OAM starts at the beginning of `io` (address `$FE00-$FE9F`).

```cpp
for (uint8_t *sprite = io; sprite < io + 160; sprite += 4) {
  ...
}
```

The sprite's coordinate is `(sprite[1] - 8, sprite[0] - 16)`. Similar to the
background tile, we can find which row and column of the sprite tile by
subtracting the current pixel's coordinate from the sprite's. The sprite's tile
is drawn if the x- and y-offset are both less than 8:

```cpp
uint8_t sprite_x = tmp - sprite[1] + 8,
        sprite_y = LY - *sprite + 16;

if (sprite_x < 8 && sprite_y < 8) {
  ...
}
```

As with the background tile, we want to xor the x-offset with 7 so the
most-significant bit is also the leftmost bit. However, a sprite can also be
flipped horizontally if bit 5 of `sprite[3]` is set. In that case we can
leave the x-offset as it is by xor'ing it with 0:

```cpp
sprite_x ^= sprite[3] & 32 ? 0 : 7;
```

Again, like background tiles, we want to fetch the tile data row for this
sprite. The sprite's tile is in `sprite[2]`. The sprite can also be flipped
vertically, so we xor the sprite's y-offset with 7 if bit 6 of `sprite[3]`
is set.

```cpp
tile_data =
    &video_ram[sprite[2] * 16 +
               (sprite_y ^ (sprite[3] & 64 ? 7 : 0)) * 2];
```

We can then extract the color of the sprite's pixel:

```cpp
uint8_t sprite_color =
  (tile_data[1] >> sprite_x) % 2 * 2 +
  (*tile_data >> sprite_x) % 2;
```

A sprite's pixel is only drawn if the sprite's pixel is non-transparent. In
addition, the background pixel also must be transparent or the sprite must have
priority over the background for the sprite's pixel to be drawn. In other
words, if the background pixel is non-transparent and the sprite doesn't have
priority, then the sprite's pixel will _not_ be drawn.

The sprite priority is bit 7 of `sprite[3]`; if it is 1, then the sprite is
drawn behind the background.

The sprite can use one of two palettes, `OBP0` and `OBP1`. If bit 3 of
`sprite[3]` is 1, then palette `OBP1` is used. We want `palette_index` to be
1 for `OBP0` and 2 for `OBP1`, so we add one to the value. `!!` is a little
trick to convert a non-zero value to 1:

```cpp
if (!((sprite[3] & 128) && color) && sprite_color) {
  color = sprite_color;
  palette_index += 1 + !!(sprite[3] & 8);
  break;
}
```

Now that we know the `color` and `palette_index`, we can look it up in the
`palette` to find the actual `RGBA` color to draw. Each palette is a single
byte, stored like this:

| Name | Address | `io` offset | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| - | - | - | - | - | - | - | - | - | - | - |
| BGP | $FF47 | 327 <td colspan=2 class="td-colspan"> color 3 <td colspan=2 class="td-colspan"> color 2 <td colspan=2 class="td-colspan"> color 1 <td colspan=2 class="td-colspan"> color 0
| OBP0 | $FF48 | 328 <td colspan=2 class="td-colspan"> color 3 <td colspan=2 class="td-colspan"> color 2 <td colspan=2 class="td-colspan"> color 1 <td colspan=2 class="td-colspan"> color 0
| OBP1 | $FF49 | 329 <td colspan=2 class="td-colspan"> color 3 <td colspan=2 class="td-colspan"> color 2 <td colspan=2 class="td-colspan"> color 1 <td colspan=2 class="td-colspan"> color 0

Adding 327 to `palette_index` gives us the offset in `io` for the palette. We
can then shift the palette byte to the right by `2 * color` to isolate the
palette entry we want.

We'll write the final `RGBA` color into the frame buffer at the current pixel's
x- and y-coordinate, `(tmp, LY)`.

```cpp
frame_buffer[LY * 160 + tmp] =
    palette[(io[327 + palette_index] >> (2 * color)) % 4 +
            palette_index * 4];
```

![pacing-gif][]

### Rendering with SDL

Once we've finished drawing all the lines, we can finally draw the framebuffer
to the window! First we have to lock the texture that we created before, so we
have access to its pixels. The `tmp` parameter stores the pitch of the texture,
i.e. the width of a row of the texture in bytes, which may include extra
padding.

```cpp
void *pixels;
SDL_LockTexture(texture, 0, &pixels, &tmp);
```

For each row of the frame buffer, we copy it into the texture. The total number
of bytes copied per row is `160 * 4 == 640`, since an `RGBA` pixel is 4
bytes:

```cpp
for (tmp2 = 144; --tmp2 >= 0;)
  memcpy((uint8_t *)pixels + tmp2 * tmp, frame_buffer + tmp2 * 160,
         640);
```

Then we unlock the texture, render it to the window's back buffer, and then
present it to the screen:

```cpp
SDL_UnlockTexture(texture);
SDL_RenderCopy(renderer, texture, 0, 0);
SDL_RenderPresent(renderer);
```

As the very final step, we poll for events, checking to see if the user quit.
This also updates `key_state`, so we can read from it directly.

```cpp
SDL_Event event;
while (SDL_PollEvent(&event))
  if (event.type == SDL_QUIT)
    return 0;
```

![title-scroll-gif][]

## Formatting the Code

Before I sent the tweet, I wanted to make the code look cool. I remember
looking at some examples from the [IOCCC][] and thought I'd take a chance at
formatting the code into a picture. See, for example, [Don Yang's winning
entry][ioccc-yang] from the 2020 competition:

![ioccc-yang-png][]

To start, I took the source code I had, and renamed all the variables to single
letter names, where possible. I then removed all whitespace to see how many
characters I was using, which was 4150 bytes, not including the `#include` and
`#define` lines.

My first thought was to use the Pokemon logo itself. I tried to make a good 1
bit-per-pixel version, but it ended up looking like garbage when I tried to fit
the source code to it:

![pokemon-logo-png][]

My next thought was to use a single pokéball. I used the awesome [Desmos online
calculator][desmos] to try to figure out how big each circle should be
interactively:

![desmos-png][]

This looks pretty good, but it's a very large pokéball with a diameter of 96. I
realized that three pokéballs side-by-side would probably work better, giving a
width of 150 and a height of 50:

![desmos2-png][]

I then recreated as a 150x50 pixel image so that I could convert it to text and
use it as a guide for my source code layout:

![3pokeballs-png][]

The result ends up stretched vertically, since most fonts are taller than they
are wide, but I still think it looks good! Maybe next time I'll try to take
that into account.

![ascii-pokeballs-png][]

![fight-win-gif][]

## Conclusion

I had a lot of fun making pokegb, and I hope you enjoyed reading about it! If I
left anything out or made any mistakes, feel free to send me a message on
twitter [@binjimint][]. Thanks to everyone on the [emudev discord][] and the
[gbdev discord][] for making such a great community. Cheers!

[IOCCC]: https://www.ioccc.org/
[binjgb]: https://github.com/binji/binjgb
[pandocs]: https://gbdev.io/pandocs
[The Ultimate Gameboy Talk]: https://youtu.be/HyzD8pNlpwI
[8080]: https://en.wikipedia.org/wiki/Intel_8080
[z80]: https://en.wikipedia.org/wiki/Zilog_Z80
[SM83 decoding]: https://cdn.discordapp.com/attachments/465586075830845475/742438340078469150/SM83_decoding.pdf
[rra use]: https://github.com/pret/pokered/blob/2954013da1f10e11db4ec96f9586b7c01706ae1a/engine/pokemon/learn_move.asm#L109
[emudev discord]: https://discord.com/invite/AcqzxjpX
[gbdev discord]: https://discord.com/invite/tKGMPNr
[pixel fifo]: https://gbdev.io/pandocs/pixel_fifo.html
[unobfuscated]: https://gist.github.com/binji/395669d45e9005950232043ab4378abe
[pokegb issue 1]: https://github.com/binji/pokegb/issues/1
[bcd]: https://en.wikipedia.org/wiki/Binary-coded_decimal
[ones' complement]: https://en.wikipedia.org/wiki/Ones%27_complement
[two's complement]: https://en.wikipedia.org/wiki/Two%27s_complement
[bit plane]: https://en.wikipedia.org/wiki/Bit_plane
[@binjimint]: https://twitter.com/binjimint
[ioccc-yang]: https://www.ioccc.org/2020/yang/index.html
[desmos]: https://www.desmos.com/calculator

[intro-gif]: /assets/2021-06-03-pokegb.gif
[pokeprof-gif]: /assets/2021-06-03-pokegb2.gif
[fight-gif]: /assets/2021-06-03-pokegb3.gif
[fight-win-gif]: /assets/2021-06-03-pokegb4.gif
[heal-gif]: /assets/2021-06-03-pokegb5.gif
[old-man-gif]: /assets/2021-06-03-pokegb6.gif
[bug-catcher-gif]: /assets/2021-06-03-pokegb7.gif
[no-entry-gif]: /assets/2021-06-03-pokegb8.gif
[title-scroll-gif]: /assets/2021-06-03-pokegb9.gif
[pacing-gif]: /assets/2021-06-03-pokegb10.gif
[caterpillar-gif]: /assets/2021-06-03-pokegb11.gif
[pokemon-logo-png]: /assets/2021-06-03-pokemon-logo.png
[ioccc-yang-png]: /assets/2021-06-03-ioccc-2020-yang.png
[desmos-png]: /assets/2021-06-03-desmos.png
[desmos2-png]: /assets/2021-06-03-desmos2.png
[3pokeballs-png]: /assets/2021-06-03-3pokeballs.png
[ascii-pokeballs-png]: /assets/2021-06-03-ascii-pokeballs.png
