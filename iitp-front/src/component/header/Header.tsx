import React from 'react';
import SimulationControls from "./SimulationControls";
import HeaderMenu from "@component/header/HeaderMenu";
import VehicleModelSelector from "@component/setting/VehicleModelSelector";
import styles from '@css/Header.module.css'

interface Props {
    onDashboard: () => void;
}

const Header = ({ onDashboard }: Props) => {
    return (
        <header className={styles['header']}>
            <HeaderMenu/>
            <div className={styles['headerRight']}>
                <VehicleModelSelector />
                <button className={styles['dashboardBtn']} onClick={onDashboard} title="대시보드">
                    대시보드
                </button>
                <SimulationControls/>
            </div>
        </header>
    );
};

export default Header;
