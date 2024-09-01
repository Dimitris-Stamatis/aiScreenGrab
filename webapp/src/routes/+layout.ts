import type { LayoutLoad } from "./$types";

const menuData = {
    sections: [
        { name: 'Home', url: '/' },
        { name: 'About', url: '/about' },
        { name: 'Camera', url: '/camera' },
    ]
};

export const load: LayoutLoad = () => {
    return menuData;
}