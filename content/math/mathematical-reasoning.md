---
title : Mathematical Reasoning
date : 2024-04-01T18:20:24-05:00
# weight: 1
# aliases: ["/first"]
tags: [math,logic,abstract]
category: [math]
author: "David Zhang"
# author: ["Me", "You"] # multiple authors
showToc: true
TocOpen: false
draft: false
hidemeta: false
comments: false
description: "Desc Text."
canonicalURL: "https://canonical.url/to/page"
disableHLJS: true # to disable highlightjs
disableShare: false
disableHLJS: false
hideSummary: false
searchHidden: true
ShowReadingTime: true
ShowBreadCrumbs: true
ShowPostNavLinks: true
ShowWordCount: true
ShowRssButtonInSectionTermList: true
UseHugoToc: true
cover:
    image: "<image path/url>" # image path/url
    alt: "<alt text>" # alt text
    caption: "<text>" # display caption under cover
    relative: false # when using page bundles set this to true
    hidden: true # only hide on current single page
editPost:
    URL: "https://github.com/<path_to_repo>/content"
    Text: "Suggest Changes" # edit text
    appendFilePath: true # to append file path to Edit link
---

## Prelude
Math as a science, is observational, empirical, inductive, and concrete. Math as a *philosophy* is introspective, logical, dedeuctive, and abstract. Without the concrete and rigorious background of abstract mathematics, all reasoning would be rendered futile and lead to nowhere. It is impossible to understate the significance of a rigorous mathematical system. 

At its core, mathematics is a study of logic. Vice versa, logic is a study of mathematics. Regardless of the order of inclusion, understanding the basic ideals of logic are crucial to understanding mathematics. Of course, we are all endowed with a natural sense of logic and ability to evaluate the truthfullness and coherency of statements based on experience and common sense. But a deeper delve into logic is tends to be the primary distinctive line between a *mathematician and an enthusiast*. Of course, regardless of our amaturity, I hope we treat ourselves at the standards of mathematicians.

Historically, deductive reasoning has its roots with the ancient Greeks, where philosophy took root in parallel. The Greeks sought highly of *logos*, considering to the form of the world. The way, the word that sustains the world. Euclid was most well known for deriving his *Elements* of Geometry from five (not-so) simple postulates. Once the axiomatic foundation is laid, all is left is logic and clever reasoning--Right? Indeed many mathematicians sought so. Consequently, an effort on formalizing mathematics was ardently called for. Set theory, Peano axioms, and the origination of non-Euclidean Geometry were all derivatives of such movement. Hilbert based his faith of "*Wir müssen wissen. Wir werden wissen.*" (We must know. We shall know.) in the foundation of such belief--the completeness of logic. 

The obsession for formalization reached a climax in the early 20th century, when Bertrand Russell and Alfred North Whitehead wrote the prolix *Principia Mathematica* in an effort to express mathematics in symbols once and for all. 

![](/math/mathematical-reasoning/pm112.png)
(The proof for 1+1=2. [*Principia Mathematica proposition 54-43*])

All this effort, however, came--to some extent--to no avail, when Kurt Gödel demonstrated in 1930 in his famous incompleteness theorem, that there exist statements that cannot be proven to be either true or false in a axiomatic system (rephrase). This was soon affirmed with Turing's discussion on the halting problem. These efforts showed that truth is, perhaps, more fundamental than provability. In other words, truth is more fundamental than *truthfulness*. To read more on this subject, I recommend *Gödel, Escher, Bach: an Eternal Golden Braid*. I will also share my reading notes on this wonderful book.

Even though logic faces the issue of inconsistency, it sill remains at the heart of mathematics. Without logic, we would never have gotten where we are at in the first place, and it continues to guide us on the path of discovery. Now, let's delve into mathematical reasoning. 

## Statements

Axioms, theorems, propositions, correlaries, lemmas are common words referenced in any math textbook. In essence, though, they are all statements of different properties. Axioms (*synonymous with postulates, propositions*) are statements given to be true, such as "I think, therefore I am.", or "In the beginning was God." Axioms are inherently unprovable within the current axiomatic system. Through axioms and deduction, theorems, propositions, correlaries, and lemmas arise. These words denote the relationship between these statements and the significance therein. 

So, what is a statement? In the most general sense, a statement is a sentence that is either true or false. We encounter inneumerable statements everyday, so it would be pointless to give you an example. Regardless, I will give an example anyway. Consider the following statement:

"Abraham Lincoln is alive."

Is this a statement? It certainly seems so. If you heard someone proclaim this on the internet, surely you would spend 30 seconds to tell this person the falsehood of this statement.

But this is, in fact, not a statement. Anyone who heard this statement on April 17, 1955 would consider it true. But how can a statement be true and false to a different audience? That is because we are assuming context when we hear this statement. The underlying assumption is when such event took place, with most people thinking: today. So when we hear this sentence, we are subconsciously thinking of the sentence:

"Abraham Lincoln is alive *today*."

But this sentence is still not a statement, it is, in fact, an *open sentence*. Since *today* is variable depending on the context, this sentence can evaluate to either true or false depending on the context. Open sentences are important concepts to bear in mind. 

What, then, is the statement we are evaluating, it is:

"Abraham Lincoln is alive on *April, 1, AD 2024 .*"

And that would be true (unless you're on Kappa Andromedae, which is 170ly from Earth). 

There are also sentences that are not statements, such as:

"Please prove that this statement is a statement."

Although "this statement is a statement." is a tautology, the request "please prove" revokes its "statementness". It is an imperative sentence; a command, not a statement.
 
Question: is the following statement a statement--

"This statement is false."

Open sentences can be converted into statements through the addition of *qualifiers*. "x is even" is not a statement, but "For all integers x divisible by 2, x is even" is a statement. "For all" is called a *universal qualifier*. Or, one can say, "There exists an integer x such that x is even". "There exits ... such that" is a *conditional qualifier*.

## Negations and conjunctions  
Of course, we can flip a statement around by negating it. The simplest way is by adding "not" infront of every statement. "Not all cars are red", "Not all people are men"... In our two previous examples, we are actually negating universal qualifiers. Another way to say those two sentences was that "There exists a car that is not red", and "There exists a person that is not a man." The negation of a universal qualifier is a conditional qualification of the negated open sentence. 

We can also combine statements using "or", or "and". For statements $p$, $q$. 

