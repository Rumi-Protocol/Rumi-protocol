<script>
  export let title;
  export let description;
  export let color;
  
  $: colorClass = color === 'blue' ? 'text-blue-400' : 'text-purple-400';
  $: borderHoverClass = color === 'blue' ? 'hover:border-blue-500/30' : 'hover:border-purple-500/30';
  $: shadowHoverClass = color === 'blue' ? 'hover:shadow-blue-500/20' : 'hover:shadow-purple-500/20';
</script>

<div class="bg-black/60 backdrop-blur-sm p-6 rounded-xl shadow-lg 
            border border-white/10 {borderHoverClass}
            transition-all duration-300 {shadowHoverClass}
            hover:transform hover:scale-105">
  <h3 class="text-xl md:text-2xl font-semibold {colorClass}">
    {title}
  </h3>
  <p class="text-gray-300 mt-3">
    {description}
  </p>
</div>