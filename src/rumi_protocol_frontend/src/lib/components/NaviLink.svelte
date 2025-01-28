<script>
  export let href;
  export let active = false;
  export let isWhitepaper = false;
</script>

<a 
  {href} 
  class="px-10 py-5 rounded-xl font-medium text-1xl lg:text-2xl
         transition-all duration-300 transform hover:scale-105
         {isWhitepaper ? 
           'bg-gradient-to-r from-gray-900 to-gray-900 hover:from-purple-600 hover:to-pink-400' : 
           'bg-gray-900/100 hover:bg-purple-500/80'} 
         ring-2 ring-gray-300/50

         shadow-lg shadow-gray-500/20
         whitespace-nowrap"
  target={isWhitepaper ? "_blank" : undefined}
>
  <slot />
</a>

<style>
  a {
    letter-spacing: 0.5px;
  }
</style>