<script lang="ts">
    import type { LayoutData } from "./$types";
    import { page } from "$app/stores";

    export let data: LayoutData;
</script>

<nav>
    {#each data.sections as section}
        <a href={section.url} class:active={$page.url.pathname == section.url}>
            {section.name}
        </a>
    {/each}
</nav>

<slot></slot>

<style>
    nav {
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: #f5f5f5;
        padding: 10px;
    }

    a {
        margin: 0 10px;
        color: #333;
        text-decoration: none;
        font-weight: bold;
    }

    a.active {
        color: #000;
        border-bottom: 2px solid #000;
        transition: border-bottom 0.3s;
    }

    a:hover {
        color: #666;
    }
</style>