---
title: Binary search
count: 6
difficulty: medium
---

Binary search finds a value in a sorted list by repeatedly halving the part of the list that could contain it. The list must be sorted first; binary search does not work on unsorted data.

The algorithm looks at the middle element. If the middle element equals the target, the search is done. If the target is smaller, the search continues in the left half; if it is larger, the search continues in the right half.

Because each step discards half of the remaining elements, binary search takes about log2(n) steps for a list of n elements. Searching a sorted list of one million elements takes at most about 20 comparisons.

By contrast, linear search checks the elements one by one and may need n comparisons. Linear search is simpler and works on unsorted lists, but binary search is much faster on large sorted lists.
