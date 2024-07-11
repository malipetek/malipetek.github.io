<script>
const num = Math.floor(Math.random() * 100);
export let text = '';
</script>

{#if num%9 === 0}
  <span class="bg-blue-100 text-blue-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300">           { text } </span>
{:else if num%9 === 1}
<span class="bg-gray-100 text-gray-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded dark:bg-gray-700 dark:text-gray-300">           { text } </span>
{:else if num%9 === 2}
<span class="bg-red-100 text-red-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded dark:bg-red-900 dark:text-red-300">               { text } </span>
{:else if num%9 === 3}
<span class="bg-green-100 text-green-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded dark:bg-green-900 dark:text-green-300">       { text } </span>
{:else if num%9 === 4}
<span class="bg-yellow-100 text-yellow-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded dark:bg-yellow-900 dark:text-yellow-300">   { text } </span>
{:else if num%9 === 5}
<span class="bg-indigo-100 text-indigo-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded dark:bg-indigo-900 dark:text-indigo-300">   { text } </span>
{:else if num%9 === 6}
<span class="bg-purple-100 text-purple-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded dark:bg-purple-900 dark:text-purple-300">   { text } </span>
{:else if num%9 === 7}
<span class="bg-pink-100 text-pink-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded dark:bg-pink-900 dark:text-pink-300">           { text } </span>
{:else if num%9 === 8}
<span class="bg-pink-100 text-pink-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded dark:bg-pink-900 dark:text-pink-300">           { text } </span>
{/if}