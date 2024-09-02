import type { LayoutLoad } from "./$types";

const menuData = {
    sections: [
        { name: 'Home', url: '/' },
        { name: 'Model Setup', url: '/model-setup' },
        { name: 'Camera', url: '/camera' },
    ]
};

export const load: LayoutLoad = () => {
    return menuData;
}