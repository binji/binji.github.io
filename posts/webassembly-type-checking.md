---
tags: post
layout: post
title:  "WebAssembly type-checking"
date:   2017-03-04
---

# A Stack Machine

Now that WebAssembly is [version 1][webassembly 1] (the first and final
official version!) more people are starting to take a look at it. One common
point of confusion is how module validation works; in particular, how
type-checking works. There are a number of things that need to be validated in
a WebAssembly module, but we'll just focus on type-checking for this blog post.

The WebAssembly format is specified in terms of a typed stack machine, and any
execution engine needs to validate the binary before it can execute it. So what
is a stack machine? In essence, it operates on expressions by pushing and
popping them from a virtual stack. Here's an example of how `3 + 4` could be
converted to WebAssembly:

```
i32.const 3
i32.const 4
i32.add
```

Each of these instructions modifies the stack, `i32.const` pushes a value on
the stack, and `i32.add` pops two values off of the stack, adds them, and
pushes the sum back on the stack. Each value on the stack has an associated
type, `i32`, `i64`, `f32`, or `f64`. These represent 32-bit integers, 64-bit
integers, 32-bit floats and 64-bit floats respectively.

In the following example, the diagram to the right of the instructions shows
the stack after the instruction has executed:

| instructions | value stack |
| --- | --- |
| `i32.const 3` | <span class="cell">i32:3</span> |
| `i32.const 4` | <span class="cell">i32:3</span><span class="cell">i32:4</span> |
| `i32.add` | <span class="cell">i32:7</span> |

# Typing the Stack Machine

In the above example, the types all match, so everything is valid. `i32.add`
expects two `i32` values to be on the top of the stack, so if they aren't
there, the module is invalid:

| stack before | result after `i32.add` |
| --- | --- |
| *empty* | **invalid**, nothing on the stack |
| | --- |
| <span class="cell">i32:0</span> | **invalid**, only one i32 on the stack |
| | --- |
| <span class="cell">i32:4</span><span class="cell">f32:3.5</span> | **invalid**, f32 on top of the stack |

The examples so far have used a value stack, and that's how a WebAssembly
interpreter would likely work. But in most cases we don't actually know the
values on the stack when the module is being validated. For example:

```
instructions
get_local 0
get_local 1
i32.add
```

Here, `get_local` is an instruction that gets a local variable's value and
pushes it on the stack. It can also be used to get the value of a function
parameter. In either case, we don't know what the value is that will be pushed
on the stack. We do know what its type must be, though. So for validation, we
actually use a type stack, not a value stack.

Let's look at a simple example of a full function:

```
(func $add_one (param i32) (result i32)
  get_local 0
  i32.const 1
  i32.add)
```

We can calculate the type stack after each instruction like this:

| instructions | type stack |
| --- | --- |
| `get_local 0` | <span class="cell">i32</span> |
| `i32.const 1` | <span class="cell">i32</span><span class="cell">i32</span> |
| `i32.add` | <span class="cell">i32</span> |

Notice that the stack has exactly one `i32` value at the end of the function.
This will become the return value of the function. This function is valid, and
if you were to run it, it would increment its argument by one.

# More instructions

Most WebAssembly instructions manipulate the stack in simple ways, like
`i32.add`. They pop a few operands of a given type off the stack, and push a
result. Here are some examples:

| instruction | stack signature | description |
| --- | --- | --- |
| `f32.const` | →<span class="cell">f32</span> | push a constant f32 value |
| `i64.mul` | <span class="cell">i64</span><span class="cell">i64</span>→<span class="cell">i64</span> | multiply two i64 values |
| `i32.popcnt` | <span class="cell">i32</span>→<span class="cell">i32</span> | [population count][] (number of 1 bits) |
| `f32.sqrt` | <span class="cell">f32</span>→<span class="cell">f32</span> | square root |
| `i64.eqz` | <span class="cell">i64</span>→<span class="cell">i32</span> | compare equal to zero (return 1 if operand is zero, 0 otherwise) |
| `f64.lt` | <span class="cell">f64</span><span class="cell">f64</span>→<span class="cell">i32</span> | compare ordered and less than |
| `i32.trunc_s/f32` | <span class="cell">f32</span>→<span class="cell">i32</span> | truncate a 32-bit float to a signed 32-bit integer |

You can find the full list of instructions [here][all instructions].

# Block and Br

WebAssembly, unlike most other similar formats, only has structured control
flow. This means that there is no "goto" instruction. Instead, all control flow
looks more like a normal imperative language, just without any of the fancy
stuff.

A `block` is basically just a label wrapping a sequence of instructions. If you
branch to the label, control flow transfers to the end of the block. All
forward branches use a `block` and `br`, `br_if` or `br_table` instruction.

Here's an example demonstrating `br`, which does an unconditional branch.

```
block $exit
  ...
  br $exit   ;; branch to the "end" below
  nop        ;; this is never executed!
end
;; br above branches here
```

And here's an example demonstrating `br_if`, which pops an `i32` off the stack
and branches if the value is non-zero:

```
block $exit
  get_local $my_i32
  br_if $exit
  ;; This is executed if $my_i32 is zero,
  ;; then control falls through to below
  nop
end
```

This is equivalent to something like:

{% highlight javascript %}
if ($my_i32 == 0) {
  nop
}
{% endhighlight %}

`br_table` is similar, but can have multiple branch locations. It works kind of
like C's or JavaScript's `switch` statement. See the [WebAssembly semantics
doc][semantics control] for more info about it.

# If

`if` is a convenient shorthand for behavior that can be accomplished with
`block`, `br` and `br_if`. It works as you would expect:

```
get_local $my_i32
if
  ...  ;; Executed if $my_i32 is non-zero
else
  ...  ;; Executed if $my_i32 is zero
end
```

This is equivalent to:

```
block $exit
  block $true
    get_local $my_i32
    br_if $true
    ... ;; Executed if $my_i32 is zero
    br $exit
  end
  ... ;; Executed if $my_i32 is non-zero
end
```

It's also legal to have an if without an else:

```
get_local $my_i32
if
  ...  ;; Executed if $my_i32 is non-zero
end
```

This is equivalent to:

```
block $exit
  get_local $my_i32
  i32.eqz   ;; Compare equal to zero; this is like "not"
  br_if $exit
  ...  ;; Executed if $my_i32 is non-zero
end
```

Note that an `if` is also a label. Branching to it transfers control flow to
the end of the `if` block:

```
get_local $my_i32
if $exit
  br $exit  ;; Branch to the end of the if.
end
```

# Loop

All backward branches must use a loop instruction. Unlike most languages,
control flow does not automatically branch to the top of the loop, it must be
done explicitly. This means that you can fall off the bottom of a loop, just
like a block:

```
loop
  nop
  ;; Control flows from here...
end
;; ... to here.
```

Here's a simple loop:

```
loop $continue
  ...
  get_local $not_done
  br_if $continue
end
```

This is equivalent to something like:

{% highlight javascript %}
do {
  ...
} while($not_done != 0);
{% endhighlight %}

# Stack diving

Another important point about `block`, `loop` and `if`: between the beginning
and `end` of any of these constructs, the stack can never be smaller than the
size at the start. This means that you don't need to know what's "below" the
`block` on the stack to type-check it.

Here's an invalid example:

```
i32.const 1
i32.const 2
block
  i32.add  ;; Invalid, can't pop past the start of the block
end
```

Even though the stack contains two `i32` values, `i32.add` can't pop through
the `block` to access them.

# Expression-based Control Flow

WebAssembly has expression-based control flow instructions, which means that a
value can "flow" through with the control. If you know JavaScript or C, think
of it as the difference between an if statement and the ?: operator. In those
languages, an if statement does not return a value:

{% highlight javascript %}
if (something) {
  do_this();
} else {
  do_that();
}
{% endhighlight %}

Whereas the ?: operator does return a value:

{% highlight javascript %}
var value = which_one() ? this_one() : that_one();
{% endhighlight %}

In WebAssembly, you signify this with a type signature on the `block`, `loop`
or `if` instruction:

```
get_local $my_i32
if i32
  i32.const 2
else
  i32.const 3
end
;; The stack contains either i32:2 or i32:3 at this point.
```

```
block i64
  i64.const 1
end
```

```
loop f32
  f32.const 1
end
```

Branches to a label must match the type signature of the label:

```
block $exit i32
  i32.const 5
  br $exit
end
;; The stack contains i32:5 here.
```

The following example is invalid, since there is a type mismatch between the
`br` value and the block's type signature:

```
block $exit f32
  i32.const 5
  br $exit  ;; Invalid, top of stack must be f32.
end
```

`loop` is different, in that the type signature signifies the fallthrough type,
not the branch type:

```
loop $continue i32
  ...
  get_local $my_i32
  br_if $continue  ;; Does not transfer a value with control flow.
  i32.const 1
end
;; Stack contains i32:1 here.
```

# Type-checking Control Flow

The primary rule of type-checking control flow is that the contents of the
stack must be consistent for all paths through the code. The `br`, `br_if` and
`br_table` instructions help here, since they will automatically unwind the
stack to the height it was when the `block` or `if` was entered:

| instructions | type stack |
| --- | --- |
| ... | <span class="cell">...</span> |
| `f32.const 1` | <span class="cell">...</span><span class="cell">f32</span> |
| `block $exit` | <span class="cell">...</span><span class="cell">f32</span> |
| `i64.const 2` | <span class="cell">...</span><span class="cell">f32</span><span class="cell">i64</span> |
| `i32.const 3` | <span class="cell">...</span><span class="cell">f32</span><span class="cell">i64</span><span class="cell">i32</span> |
| `br $exit` | <span class="cell">\*</span> |
| `end` | <span class="cell">...</span><span class="cell">f32</span> |

The state of the stack between the `br` and the `end` is special, I'll talk
about that below.

Control can flow out of a `block` two ways: via a `br` and falling through the
bottom. The primary rule says that the stack must be consistent in both paths.
If we modify the example above to use `br_if` instead of `br`, we have to
manually "clean up" the stack before falling through the bottom for it to be
valid:

| instructions | type stack |
| --- | --- |
| ... | <span class="cell">...</span> |
| `f32.const 1` | <span class="cell">...</span><span class="cell">f32</span> |
| `block $exit` | <span class="cell">...</span><span class="cell">f32</span> |
| `i64.const 2` | <span class="cell">...</span><span class="cell">f32</span><span class="cell">i64</span> |
| `i32.const 3` | <span class="cell">...</span><span class="cell">f32</span><span class="cell">i64</span><span class="cell">i32</span> |
| `br_if $exit` | <span class="cell">...</span><span class="cell">f32</span><span class="cell">i64</span> |
| `drop` | <span class="cell">...</span><span class="cell">f32</span> |
| `end` | <span class="cell">...</span><span class="cell">f32</span> |

`drop` is an instruction which drops the top value from the stack. It's useful
in this case, but note that we could have also used a `br` after the `br_if` to
clean up the stack for us automatically.

Control can flow out of an `if` block three ways: via a `br`, and by falling
through the bottom of the true (non-zero) and false (zero) arms of the `if`.
Again, each of these paths must have a consistent stack.

Here's an invalid example:

| instructions | type stack |
| --- | --- |
| ... | <span class="cell">...</span> |
| `get_local $my_i32` | <span class="cell">...</span><span class="cell">i32</span> |
| `if i32` | <span class="cell">...</span> |
| `i32.const 2` | <span class="cell">...</span><span class="cell">i32</span> |
| `else` | <span class="cell">...</span> |
| `f32.const 3` | <span class="cell">...</span><span class="cell">f32</span> |
| `end` | <span class="cell">...</span><span class="cell">???</span> |

It's not clear at the end of the `if` what the state of the stack is: if
`$my_i32` is non-zero, then the stack top is `i32`, if `$my_i32` is zero, then
the stack top is `f32`. The type-signature of the `if` tells us which is
correct. It explicitly says that, at `end`, the stack must contain whatever was
there before (<span class="cell">...</span>), plus an `i32` on top. Since the
false branch has an `f32` on top, this example is invalid.

You can always look at the signature of a `block`, `loop` or `if` and determine
how it will manipulate the stack, without looking at any of its contents. Some
examples:

| instruction | stack signature |
| --- | --- | --- |
| `block i32 ... end` | →<span class="cell">i32</span> |
| `if f32 ... end` | →<span class="cell">f32</span> |
| `loop i64 ... end` | →<span class="cell">i64</span> |
| `block ... end` | → |

# Unreachable code

Remember above when I said the state of the stack between a `br` and `end` is
special? That's because it is unreachable code. Since it's not possible to
actually execute the code at this point, we don't know what's on the stack.

So, for example:

```
block $exit
  br $exit

  ;; We know that this code is unreachable.
  ;; What is on the stack here?
  i32.const 1
  i32.const 2
  i32.add
  ...
end
```

In a way, it doesn't really matter, right? Since you can never execute this
code, it doesn't matter what is on the stack. There was a
[lot of discussion][unreachable] about what to do in this case, but finally we
decided to do what we called "full type-checking". This means that unreachable
code is type-checked, but in a somewhat special way.

Because the stack could have anything on it, we say that it is
"polymorphic". When we type-check unreachable code, we're trying to determine
whether an initial type stack exists that would type-check if we were to start
executing the unreachable code. Every instruction gives us clues as to what this
stack must be. If we ever rule out all possible stacks, we've determined that
the code is invalid.

This sounds complicated, but there's a trick to make it easy to do. In a way,
the type-checking works exactly the same as it always had. The only difference
is what happens when you pop from the polymorphic stack: you always get exactly
what you wanted:

```
block $exit
  br $exit  ;; stack is polymorphic
  i32.add   ;; pop twice from the polymorphic stack
            ;; we wanted two i32s, and we got them!
end
```

This seems weird, right? How does the polymorphic stack "know" we want `i32`s?
I find that it's easist to think of it as proving what must be on the stack for
the code to type-check. Let's extract the unreachable code:

```
i32.add
```

We know that `i32.add` pops two `i32`s and pushes their sum as an `i32`. So for
this code to be valid, the stack must be: <span
class="cell">i32</span><span class="cell">i32</span>. Any other
stack wouldn't be valid.

Let's take a look at another example:

```
unreachable
i32.const 1
i32.add
```

`unreachable` is a WebAssembly instruction that makes the stack polymorphic.
This is because if `unreachable` is ever executed, the WebAssembly execution
must "trap" and stop running code. This manifests as an exception when
WebAssembly is embedded in a JavaScript environment. In any case, the
instructions after an `unreachable` are never executed.

Here's what the stack looks like if we could execute this unreachable code
(where <span class="cell">\*</span> is the polymorphic stack):

| instructions | type stack |
| --- | --- |
| `unreachable` | <span class="cell">\*</span> |
| `i32.const 1` | <span class="cell">\*</span><span class="cell">i32</span> |
| `i32.add` | <span class="cell">\*</span><span class="cell">i32</span> |

When the `i32.add` is excuted, it pops the top value of the stack, which is an
`i32`. Then it pops the next value, which is from the polymorphic stack. Since
the polymorphic stack gives us whatever we want, we get an `i32` here too.
Finally, `i32.add` pushes the sum as a `i32`. We know now that the only valid
concrete stack is <span class="cell">i32</span>. If we substitute this
for the initial polymorphic stack, we can see why:

| instructions | type stack |
| --- | --- |
| *initial stack*| <span class="cell">i32</span> |
| `i32.const 1` | <span class="cell">i32</span><span class="cell">i32</span> |
| `i32.add` | <span class="cell">i32</span> |

Here's an example where type-checking unreachable code fails:

```
unreachable
i32.const 1
f32.mul
```

This is invalid because the `f32.mul` expects two `f32` operands, but the top
of the stack has an `i32`.

# Odds and Ends

There are a few other operators worth making a quick note about.

- `select`: similar to `if`, but always evaluates both arms
- `return`: returns from a function; stack is polymorphic afterward
- `call`: calls a function; pops the parameters, pushes the result
- `call_indirect`: calls a function by index; same as `call` w.r.t.
  type-checking

# Wabt

If you want to see how I implemented type-checking, take a look at
[wabt's type-checker][wabt type-checker]. The
[spec interpreter][spec type-checker] has an implementation in OCaml as well,
if you're curious.

Whew, this has been a long blog post, and I still didn't cover everything! If
you have any questions, just ask me on twitter. If there are enough, I'll
probably do a follow-up. Thanks for reading, and see you next time!

[webassembly 1]: https://lists.w3.org/Archives/Public/public-webassembly/2017Feb/0002.html
[population count]: https://en.wikipedia.org/wiki/Hamming_weight
[semantics control]: https://github.com/WebAssembly/design/blob/master/Semantics.md#control-constructs-and-instructions
[all instructions]: https://github.com/WebAssembly/design/blob/master/BinaryEncoding.md#control-flow-operators-described-here
[unreachable]: https://github.com/WebAssembly/design/pull/894
[wabt type-checker]: https://github.com/WebAssembly/wabt/blob/master/src/type-checker.cc
[spec type-checker]: https://github.com/WebAssembly/spec/blob/master/interpreter/valid/valid.ml
