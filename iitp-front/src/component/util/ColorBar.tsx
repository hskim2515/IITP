function ColorBar({ colormap }) {
    return (
        <div style={{
            width: '100%',
            height: '20px',
            background: `linear-gradient(to right, ${colormap.join(', ')})`,
            border: '1px solid #ccc',
            borderRadius: '4px',
            marginTop: '10px'
        }} />
    );
}

export default ColorBar;