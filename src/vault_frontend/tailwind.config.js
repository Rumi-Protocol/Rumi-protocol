import containerQueries from '@tailwindcss/container-queries';
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';
import plugin from 'tailwindcss/plugin';

export default {
  content: [
	"./src/**/*.{html,js,svelte,ts}",
	"./node_modules/layerchart/**/*.{svelte,js}",
	],
  theme: {
    extend: {
      screens: {
        xs: "400px", 
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
      },
      colors: {
        primary: '#00b4d8',
        // Custom gradient colors
        'gradient-start': '#8b5cf6',
        'gradient-end': '#d8b4fe',
      },
      animation: {
        'gradient-xy': 'gradient-xy 15s ease infinite',
        'gradient-move': 'gradientMove 15s ease infinite',
		'spin-slow': 'spin 10s linear infinite',
        'spin-slow-reverse': 'spin 10s linear infinite reverse',
      },
      keyframes: {
        'gradient-xy': {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '50%': { transform: 'translate(-30%, -30%)' },
        },
        'gradientMove': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-end) 100%)',
      },
    },
  },
  plugins: [
    typography, 
	forms,
	containerQueries,
    plugin(({ addVariant }) => {
		addVariant('light', ':root:not(.dark) &')
	  }),
	  plugin(({ addUtilities }) => {
		addUtilities({
		  '.scrollbar-custom': {
			'&::-webkit-scrollbar': {
			  width: '8px',
			  height: '8px',
			},
			'&::-webkit-scrollbar-track': {
			  backgroundColor: '#1a1b23',
			},
			'&::-webkit-scrollbar-thumb': {
			  backgroundColor: '#60a5fa',
			  borderRadius: '4px',
			  border: '2px solid #1a1b23',
			},
			'&::-webkit-scrollbar-thumb:hover': {
			  backgroundColor: '#3b82f6',
			},
			'scrollbar-width': 'thin',
			'scrollbar-color': '#60a5fa #1a1b23',
		  },
		})
	  }),
	],
 };
