<script lang="ts">
  export let href: string;
  export let active: boolean = false;
  export let isWhitepaper: boolean = false;
</script>

<a
  {href}
  class="nav-text"
  class:active
  target={isWhitepaper ? "_blank" : undefined}
  rel={isWhitepaper ? "noopener noreferrer" : undefined}
>
  <slot />
</a>

<style>
  a {
    letter-spacing: 0.5px;
    text-shadow: 0 2px 4px rgba(0,0,0,0.2);
    font-size: 1.15rem;
    padding: 0.5rem 1rem;
  }
</style>