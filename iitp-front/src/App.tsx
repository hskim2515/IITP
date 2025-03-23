import React, {useRef} from 'react';
import './App.css'
import Maps from "./component/map/Maps";
import Header from "./component/header/Header";
import LeftPanel from "./component/pannel/LeftPanel";
import Tools from "./component/tool/Tools";
import ToolsPanel from "./component/tool/ToolsPanel";

function App() {

  return (
    <>
      <div>

          <Header />
          <LeftPanel />
          <Tools />
          <ToolsPanel />
          <Maps></Maps>
      </div>
    </>
  )
}

export default App
