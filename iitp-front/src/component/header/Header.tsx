import React from 'react';
import SimulationControls from "./SimulationControls";
import HeaderMenu from "@component/header/HeaderMenu";
import styles from '@css/Header.module.css'

const Header = () => {
    return (
        <header className={styles['header']}>
            <HeaderMenu/>
            <SimulationControls/>
        </header>
    );
};

export default Header;
