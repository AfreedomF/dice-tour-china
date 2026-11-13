import React from 'react';
import {createRoot} from 'react-dom/client';
import {createGameUI} from './game-ui.js';
import * as content from '../shared/content.js';
const Game=createGameUI(React,content);
createRoot(document.getElementById('game')).render(React.createElement(Game));
