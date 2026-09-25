<script lang="ts">
    export let image = '0000000000000000000000000';

    const colours = [
        '#111827',
        '#422006',
        '#713f12',
        '#854d0e',
        '#a16207',
        '#ca8a04',
        '#eab308',
        '#facc15',
        '#fde047',
        '#fef08a'
    ];

    function getPixels(value: string) {
        return value.padEnd(25, '0').slice(0, 25).split('');
    }

    $: pixels = getPixels(image);
</script>

<div
    class="rounded-xl border border-gray-600 bg-gray-950 p-3 shadow-inner"
    role="img"
    aria-label="Hub 5 by 5 LED matrix"
>
    <div class="grid grid-cols-5 gap-2">
        {#each pixels as pixel}
            <span
                class="aspect-square w-5 rounded-sm border border-yellow-100/10 shadow-sm"
                style:background-color={colours[Number(pixel)] ?? colours[0]}
            ></span>
        {/each}
    </div>
</div>
