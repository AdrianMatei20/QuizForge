# Recursion

A recursive function is a function that calls itself to solve a smaller version of the same problem. Every recursive function needs a base case, which is a condition where the function returns a result without calling itself. Without a base case, the function would call itself forever.

Each recursive call must move closer to the base case. For example, a function that computes the factorial of n returns 1 when n is 0, and otherwise returns n multiplied by the factorial of n minus 1.

When a function calls itself, the computer stores each unfinished call on the call stack. If the recursion goes too deep, the call stack runs out of space and the program fails with a stack overflow error.

Many recursive solutions can also be written with a loop. A loop is often faster and uses less memory, but recursion can make code for problems like walking a tree much easier to read.
